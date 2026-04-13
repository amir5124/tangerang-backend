const cron = require('node-cron');
const db = require('../config/db');
const { internalReleaseFunds } = require('../controllers/orderController');

cron.schedule('*/5 * * * *', async () => {
    const timestamp = new Date().toLocaleString('id-ID');
    let connection;

    try {
        connection = await db.getConnection();

        // Flag untuk menandai apakah header log sudah dicetak
        let headerLogged = false;
        const logHeader = () => {
            if (!headerLogged) {
                console.log(`\n--- [CRON START: ${timestamp}] ---`);
                headerLogged = true;
            }
        };

        /**
         * TASK 1: AUTO-CANCEL EXPIRED PAYMENTS (SYSTEM CANCEL)
         * Jika pembayaran expired, dianggap dibatalkan oleh system.
         */
        const [expiredPayments] = await connection.execute(`
            SELECT p.order_id, p.transaction_id 
            FROM payments p 
            WHERE p.payment_status = 'pending' 
            AND p.expired_at <= DATE_ADD(NOW(), INTERVAL 7 HOUR)
        `);

        if (expiredPayments.length > 0) {
            logHeader();
            console.log(`[TASK 1] Found ${expiredPayments.length} expired payments.`);
            for (const pay of expiredPayments) {
                await connection.beginTransaction();
                try {
                    await connection.execute("UPDATE payments SET payment_status = 'expire' WHERE transaction_id = ?", [pay.transaction_id]);
                    await connection.execute("UPDATE orders SET status = 'cancelled', cancelled_by = 'system' WHERE id = ?", [pay.order_id]);
                    await connection.execute("INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'cancelled', 'Payment expired (System)')", [pay.order_id]);
                    await connection.commit();
                    console.log(`   ✅ Order #${pay.order_id}: Expired.`);
                } catch (err) {
                    await connection.rollback();
                    console.error(`   ❌ Task 1 Error #${pay.order_id}:`, err.message);
                }
            }
        }

        /**
         * TASK 2: AUTO-COMPLETE (CONFIRMATION TIMEOUT)
         */
        const [expiredWork] = await connection.execute(`
            SELECT id FROM orders 
            WHERE status = 'working' 
            AND proof_image_url IS NOT NULL
            AND updated_at <= DATE_ADD(NOW(), INTERVAL 7 HOUR) - INTERVAL 24 HOUR
        `);

        if (expiredWork.length > 0) {
            logHeader();
            console.log(`[TASK 2] Found ${expiredWork.length} orders for auto-completion.`);
            for (const order of expiredWork) {
                await connection.beginTransaction();
                try {
                    await connection.execute("UPDATE orders SET status = 'completed' WHERE id = ?", [order.id]);
                    await internalReleaseFunds(connection, order.id);
                    await connection.commit();
                    console.log(`   ✅ Order #${order.id}: Auto-completed.`);
                } catch (err) {
                    await connection.rollback();
                    console.error(`   ❌ Task 2 Error #${order.id}:`, err.message);
                }
            }
        }

        /**
         * TASK 3: UNIFIED REFUND SYSTEM (Customer, Mitra, System)
         */
        const [refundQueue] = await connection.execute(`
            SELECT o.id, o.customer_id, o.store_id, o.total_price, o.platform_fee, o.service_fee, o.cancelled_by,
                   s.user_id AS mitra_user_id
            FROM orders o
            JOIN payments p ON o.id = p.order_id
            JOIN stores s ON o.store_id = s.id
            WHERE o.status = 'cancelled' 
            AND p.payment_status = 'settlement'
            AND o.cancelled_by IS NOT NULL
        `);

        if (refundQueue.length > 0) {
            logHeader();
            console.log(`[TASK 3] Processing ${refundQueue.length} refunds.`);
            for (const order of refundQueue) {
                await connection.beginTransaction();
                try {
                    // Lock row anti-double refund
                    const [check] = await connection.execute("SELECT payment_status FROM payments WHERE order_id = ? FOR UPDATE", [order.id]);
                    if (!check[0] || check[0].payment_status === 'refund') {
                        await connection.rollback();
                        continue;
                    }

                    let refundToCustomer = 0;
                    let penaltyToMitra = 0;
                    let refundNote = "";

                    const baseAmount = parseFloat(order.total_price) + parseFloat(order.platform_fee || 0);
                    const serviceFee = parseFloat(order.service_fee || 0);

                    // LOGIKA REFUND BERDASARKAN CANCELLED_BY
                    if (order.cancelled_by === 'customer') {
                        // Customer batal: Refund Total + Platform Fee (Aplikator tanggung admin PG)
                        refundToCustomer = baseAmount;
                        refundNote = "Refund (Customer Cancel): Total + Platform Fee.";
                    }
                    else if (order.cancelled_by === 'mitra') {
                        // Mitra batal: Refund Total + Platform Fee + Service Fee (Mitra ganti rugi admin PG)
                        refundToCustomer = baseAmount + serviceFee;
                        penaltyToMitra = serviceFee;
                        refundNote = `Refund (Mitra Cancel): Total + Platform Fee + Service Fee (Dipotong dari saldo Mitra).`;
                    }
                    else {
                        // System batal: Refund Total + Platform Fee + Service Fee (Aplikator tanggung semua)
                        refundToCustomer = baseAmount + serviceFee;
                        refundNote = "Refund (System/Expired): Full Refund (Total + Platform + Service Fee).";
                    }

                    // 1. Ambil Wallet Customer
                    const [wallets] = await connection.execute("SELECT id FROM wallets WHERE user_id = ?", [order.customer_id]);
                    if (wallets.length === 0) throw new Error("Customer wallet not found");
                    const walletId = wallets[0].id;

                    // 2. Tandai Payment sebagai Refunded
                    await connection.execute("UPDATE payments SET payment_status = 'refund' WHERE order_id = ?", [order.id]);

                    // 3. Tambahkan Saldo ke Customer
                    await connection.execute("UPDATE wallets SET balance = balance + ? WHERE id = ?", [refundToCustomer, walletId]);
                    await connection.execute("INSERT INTO wallet_transactions (wallet_id, amount, type, description) VALUES (?, ?, 'credit', ?)",
                        [walletId, refundToCustomer, `Refund Otomatis Order #${order.id}`]);

                    // 4. Potong saldo mitra jika pembatalan oleh mitra (Penalty)
                    if (penaltyToMitra > 0) {
                        await connection.execute("UPDATE users SET saldo = saldo - ? WHERE id = ?", [penaltyToMitra, order.mitra_user_id]);
                        console.log(`   [DEBUG] Order #${order.id}: Mitra ${order.mitra_user_id} penalty Rp${penaltyToMitra}`);
                    }

                    // 5. Simpan Log Order
                    await connection.execute("INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'cancelled', ?)",
                        [order.id, refundNote]);

                    await connection.commit();
                    console.log(`   ✅ Order #${order.id}: Refunded Rp${refundToCustomer} to Customer (Cancelled by ${order.cancelled_by.toUpperCase()}).`);
                } catch (err) {
                    await connection.rollback();
                    console.error(`   ❌ Task 3 Error #${order.id}:`, err.message);
                }
            }
        }

    } catch (error) {
        console.error('--- [CRON GLOBAL ERROR] ---', error);
    } finally {
        if (connection) connection.release();
    }
});