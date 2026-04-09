const cron = require('node-cron');
const db = require('../config/db');
const { internalReleaseFunds } = require('../controllers/orderController');

/**
 * JADWAL: Setiap 1 menit (* * * * *)
 */
cron.schedule('* * * * *', async () => {
    const timestamp = new Date().toLocaleString('id-ID');
    console.log(`\n--- [CRON START: ${timestamp}] ---`);

    const connection = await db.getConnection();

    try {
        /**
         * TASK 1: AUTO-CANCEL EXPIRED PAYMENTS
         */
        const [expiredPayments] = await connection.execute(`
            SELECT p.order_id, p.transaction_id 
            FROM payments p 
            WHERE p.payment_status = 'pending' 
            AND p.expired_at <= DATE_ADD(NOW(), INTERVAL 7 HOUR)
        `);

        if (expiredPayments.length > 0) {
            console.log(`[TASK 1] Found ${expiredPayments.length} expired payments.`);
            for (const pay of expiredPayments) {
                await connection.beginTransaction();
                try {
                    await connection.execute("UPDATE payments SET payment_status = 'expire' WHERE transaction_id = ?", [pay.transaction_id]);
                    await connection.execute("UPDATE orders SET status = 'cancelled' WHERE id = ?", [pay.order_id]);
                    await connection.execute("INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'cancelled', 'Payment link expired')", [pay.order_id]);
                    await connection.commit();
                    console.log(`   ✅ Order #${pay.order_id}: Cancelled (Expired).`);
                } catch (err) {
                    await connection.rollback();
                    console.error(`   ❌ Error Task 1 #${pay.order_id}:`, err.message);
                }
            }
        }

        /**
         * TASK 2: AUTO-COMPLETE (CONFIRMATION TIMEOUT 24H)
         */
        const [expiredWork] = await connection.execute(`
            SELECT id FROM orders 
            WHERE status = 'working' 
            AND proof_image_url IS NOT NULL
            AND updated_at <= DATE_ADD(NOW(), INTERVAL 7 HOUR) - INTERVAL 24 HOUR
        `);

        if (expiredWork.length > 0) {
            console.log(`[TASK 2] Found ${expiredWork.length} orders for auto-completion.`);
            for (const order of expiredWork) {
                await connection.beginTransaction();
                try {
                    await connection.execute("UPDATE orders SET status = 'completed' WHERE id = ?", [order.id]);
                    // internalReleaseFunds biasanya menangani transfer ke wallet mitra
                    await internalReleaseFunds(connection, order.id);
                    await connection.commit();
                    console.log(`   ✅ Order #${order.id}: Auto-completed.`);
                } catch (err) {
                    await connection.rollback();
                    console.error(`   ❌ Error Task 2 #${order.id}:`, err.message);
                }
            }
        }

        /**
         * TASK 3: AUTO-REFUND (NO PARTNER RESPONSE - 5 MINS)
         * Menggunakan tabel wallets & wallet_transactions sebagai sumber data keuangan.
         */
        const [noResponseOrders] = await connection.execute(`
            SELECT id, customer_id, total_price 
            FROM orders 
            WHERE status = 'pending' 
            AND updated_at <= DATE_ADD(NOW(), INTERVAL 7 HOUR) - INTERVAL 5 MINUTE
        `);

        if (noResponseOrders.length > 0) {
            console.log(`[TASK 3] Found ${noResponseOrders.length} orders for refund.`);
            for (const order of noResponseOrders) {
                await connection.beginTransaction();
                try {
                    // 1. Dapatkan Wallet ID customer
                    const [wallets] = await connection.execute(
                        "SELECT id FROM wallets WHERE user_id = ?",
                        [order.customer_id]
                    );

                    if (wallets.length === 0) {
                        throw new Error(`Wallet tidak ditemukan untuk user ${order.customer_id}`);
                    }

                    const walletId = wallets[0].id;

                    // 2. Update Status Order & Payment
                    await connection.execute("UPDATE orders SET status = 'cancelled' WHERE id = ?", [order.id]);
                    await connection.execute("UPDATE payments SET payment_status = 'refund' WHERE order_id = ?", [order.id]);

                    // 3. Tambahkan Saldo ke Tabel Wallets (Single Source of Truth)
                    await connection.execute(
                        "UPDATE wallets SET balance = balance + ? WHERE id = ?",
                        [order.total_price, walletId]
                    );

                    // 4. Catat Riwayat Transaksi di wallet_transactions
                    await connection.execute(`
                        INSERT INTO wallet_transactions (wallet_id, amount, type, description) 
                        VALUES (?, ?, 'credit', ?)`,
                        [
                            walletId, 
                            order.total_price, 
                            `Refund otomatis Order #${order.id} (Mitra tidak merespon)`
                        ]
                    );

                    // 5. Catat Log Order
                    await connection.execute(
                        "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'cancelled', ?)",
                        [order.id, `Refund otomatis Rp${order.total_price} berhasil dikirim ke wallet.`]
                    );

                    await connection.commit();
                    console.log(`   ✅ Order #${order.id}: Refunded to Wallet ID ${walletId}.`);
                } catch (err) {
                    await connection.rollback();
                    console.error(`   ❌ Error Task 3 #${order.id}:`, err.message);
                }
            }
        } else {
            console.log("[TASK 3] Clean. No orders need refund.");
        }

    } catch (error) {
        console.error('--- [CRON GLOBAL ERROR] ---', error);
    } finally {
        connection.release();
        console.log(`--- [CRON FINISHED] ---\n`);
    }
});