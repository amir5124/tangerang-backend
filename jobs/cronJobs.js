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

                    // LOGIKA REFUND BERDASARKAN CANCELLED_BY
                    const baseAmount = parseFloat(order.total_price); // Harga Layanan
                    const platformFee = parseFloat(order.platform_fee || 0); // Biaya Layanan
                    const serviceFee = parseFloat(order.service_fee || 0); // Biaya Transaksi (Admin PG)

                    if (order.cancelled_by === 'customer') {
                        /**
                         * CANCEL BY USER:
                         * - Customer tanggung service_fee (biaya transaksi).
                         * - Refund ke customer: total_price + platform_fee.
                         */
                        refundToCustomer = baseAmount + platformFee;
                        refundNote = "Refund (Customer Cancel): Total + Platform Fee. Biaya transaksi ditanggung user.";
                    }
                    else if (order.cancelled_by === 'mitra') {
                        /**
                         * CANCEL BY MITRA:
                         * - Mitra tanggung service_fee (biaya transaksi).
                         * - Refund ke customer: 100% (total_price + platform_fee + service_fee).
                         * - Saldo Mitra dipotong sebesar service_fee (sebagai penalti).
                         */
                        refundToCustomer = baseAmount + platformFee + serviceFee;
                        penaltyToMitra = serviceFee;
                        refundNote = "Refund (Mitra Cancel): Full Refund. Biaya transaksi dipotong dari saldo mitra.";
                    }
                    else {
                        /**
                         * CANCEL BY SYSTEM (Batas waktu habis/tidak ada respon):
                         * - 100% Refund ke customer: total_price + platform_fee + service_fee.
                         * - Aplikator menanggung semua biaya.
                         */
                        refundToCustomer = baseAmount + platformFee + serviceFee;
                        refundNote = "Refund (System/No Response): Full Refund (Total + Platform + Service Fee).";
                    }

                    // 1. Ambil Wallet Customer
                    const [wallets] = await connection.execute("SELECT id FROM wallets WHERE user_id = ?", [order.customer_id]);
                    if (wallets.length === 0) throw new Error("Customer wallet not found");
                    const walletId = wallets[0].id;

                    // 2. Tandai Payment sebagai Refunded
                    await connection.execute("UPDATE payments SET payment_status = 'refund' WHERE order_id = ?", [order.id]);

                    // 3. Tambahkan Saldo ke Customer (Wallets) dan Catat Transaksi
                    await connection.execute("UPDATE wallets SET balance = balance + ? WHERE id = ?", [refundToCustomer, walletId]);
                    await connection.execute(
                        "INSERT INTO wallet_transactions (wallet_id, amount, type, description) VALUES (?, ?, 'credit', ?)",
                        [walletId, refundToCustomer, `Refund Otomatis Order #${order.id} (${order.cancelled_by})`]
                    );

                    // 4. Potong saldo mitra jika pembatalan oleh mitra (Penalty)
                    // Menggunakan tabel wallets jika mitra juga punya wallet, atau tabel users (saldo) sesuai skema Anda
                    if (penaltyToMitra > 0) {
                        // Pastikan mitra memiliki wallet atau update kolom saldo di tabel users
                        await connection.execute("UPDATE users SET saldo = saldo - ? WHERE id = ?", [penaltyToMitra, order.mitra_user_id]);

                        // Opsional: Catat transaksi pemotongan saldo mitra jika ada tabel log-nya
                        console.log(`   [PENALTY] Order #${order.id}: Saldo Mitra ${order.mitra_user_id} dipotong Rp${penaltyToMitra} (Biaya Transaksi)`);
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