const cron = require('node-cron');
const db = require('../config/db');
const { internalReleaseFunds } = require('../controllers/orderController');

// Jalankan setiap 10 menit agar pengecekan expired payment lebih akurat
cron.schedule('*/10 * * * *', async () => {
    console.log('--- Running Scheduled Tasks ---');
    const connection = await db.getConnection();

    try {
        /**
         * TASK 1: AUTO-CANCEL EXPIRED PAYMENTS (QRIS/VA)
         * Menangani order yang tidak dibayar sampai batas waktu expired_at
         * Menggunakan DATE_ADD 7 jam karena waktu server MySQL menggunakan UTC
         */
        const [expiredPayments] = await connection.execute(`
            SELECT p.order_id, p.transaction_id 
            FROM payments p 
            WHERE p.payment_status = 'pending' 
            AND p.expired_at <= DATE_ADD(NOW(), INTERVAL 7 HOUR)
        `);

        for (const pay of expiredPayments) {
            await connection.beginTransaction();
            try {
                await connection.execute(
                    "UPDATE payments SET payment_status = 'expire' WHERE transaction_id = ?",
                    [pay.transaction_id]
                );
                await connection.execute(
                    "UPDATE orders SET status = 'cancelled' WHERE id = ?",
                    [pay.order_id]
                );
                await connection.execute(
                    "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'cancelled', 'Otomatis dibatalkan oleh sistem karena melewati batas waktu pembayaran')",
                    [pay.order_id]
                );
                await connection.commit();
                console.log(`[CRON-PAYMENT] Order #${pay.order_id} has expired and was cancelled.`);
            } catch (err) {
                await connection.rollback();
                console.error(`[CRON-PAYMENT-ERROR] Order #${pay.order_id}:`, err.message);
            }
        }

        /**
         * TASK 2: AUTO-COMPLETE & RELEASE FUNDS
         * Menangani order yang sudah dikerjakan tapi tidak dikonfirmasi pelanggan > 24 jam
         * Ditambah INTERVAL 7 jam agar pembanding updated_at akurat dengan WIB
         */
        const [expiredOrders] = await connection.execute(`
            SELECT id FROM orders 
            WHERE status = 'working' 
            AND proof_image_url IS NOT NULL
            AND updated_at <= DATE_ADD(NOW(), INTERVAL 7 HOUR) - INTERVAL 24 HOUR
        `);

        for (const order of expiredOrders) {
            await connection.beginTransaction();
            try {
                await connection.execute(
                    "UPDATE orders SET status = 'completed' WHERE id = ?",
                    [order.id]
                );
                
                await internalReleaseFunds(connection, order.id);

                await connection.commit();
                console.log(`[CRON-FUNDS] Sukses Auto-Complete Order #${order.id}`);
            } catch (err) {
                await connection.rollback();
                console.error(`[CRON-FUNDS-ERROR] Order #${order.id}:`, err.message);
            }
        }

    } catch (error) {
        console.error('Global Cron Job Error:', error);
    } finally {
        connection.release();
    }
});