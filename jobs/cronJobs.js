const cron = require('node-cron');
const db = require('../config/db');
const { internalReleaseFunds } = require('../controllers/orderController');

/**
 * JADWAL: Setiap 1 menit (* * * * *)
 * Cocok untuk testing. Jika sudah produksi, bisa diubah kembali ke 5 atau 10 menit.
 */
cron.schedule('* * * * *', async () => {
    const timestamp = new Date().toLocaleString('id-ID');
    console.log(`\n--- [CRON START: ${timestamp}] ---`);
    
    const connection = await db.getConnection();

    try {
        /**
         * TASK 1: AUTO-CANCEL EXPIRED PAYMENTS
         * Membatalkan pesanan yang link pembayarannya sudah kedaluwarsa (QRIS/VA belum dibayar).
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
                    console.log(`   ✅ Order #${pay.order_id}: Status set to Expired.`);
                } catch (err) {
                    await connection.rollback();
                    console.error(`   ❌ Error Order #${pay.order_id}:`, err.message);
                }
            }
        }

        /**
         * TASK 2: AUTO-COMPLETE (CONFIRMATION TIMEOUT)
         * Menyelesaikan otomatis jika pelanggan tidak klik "Selesai" setelah 24 jam kerja dikirim.
         */
        const [expiredWork] = await connection.execute(`
            SELECT id FROM orders 
            WHERE status = 'working' 
            AND proof_image_url IS NOT NULL
            AND updated_at <= DATE_ADD(NOW(), INTERVAL 7 HOUR) - INTERVAL 24 HOUR
        `);

        if (expiredWork.length > 0) {
            console.log(`[TASK 2] Found ${expiredWork.length} orders needing auto-completion.`);
            for (const order of expiredWork) {
                await connection.beginTransaction();
                try {
                    await connection.execute("UPDATE orders SET status = 'completed' WHERE id = ?", [order.id]);
                    await internalReleaseFunds(connection, order.id);
                    await connection.commit();
                    console.log(`   ✅ Order #${order.id}: Auto-completed & funds released.`);
                } catch (err) {
                    await connection.rollback();
                    console.error(`   ❌ Error Order #${order.id}:`, err.message);
                }
            }
        }

        /**
         * TASK 3: AUTO-REFUND (NO PARTNER RESPONSE) - TESTING 5 MENIT
         * Menangani pesanan 'pending' (sudah dibayar) yang dicuekin mitra.
         */
        const [noResponseOrders] = await connection.execute(`
            SELECT id, customer_id, total_price 
            FROM orders 
            WHERE status = 'pending' 
            AND updated_at <= DATE_ADD(NOW(), INTERVAL 7 HOUR) - INTERVAL 5 MINUTE
        `);

        if (noResponseOrders.length > 0) {
            console.log(`[TASK 3] Found ${noResponseOrders.length} orders for auto-refund.`);
            for (const order of noResponseOrders) {
                await connection.beginTransaction();
                try {
                    console.log(`   🔄 Processing Refund for Order #${order.id} (User: ${order.customer_id})...`);

                    // 1. Update status order menjadi 'cancelled'
                    await connection.execute(
                        "UPDATE orders SET status = 'cancelled' WHERE id = ?",
                        [order.id]
                    );

                    // 2. Kembalikan dana ke saldo user
                    await connection.execute(
                        "UPDATE users SET saldo = saldo + ? WHERE id = ?",
                        [order.total_price, order.customer_id]
                    );

                    // 3. Update status pembayaran menjadi 'refund'
                    await connection.execute(
                        "UPDATE payments SET payment_status = 'refund' WHERE order_id = ?",
                        [order.id]
                    );

                    // 4. Catat Log Status & Alasan
                    const logMsg = `Refund otomatis Rp${order.total_price} ke saldo. Alasan: Tidak ada respon mitra (5 min timeout).`;
                    await connection.execute(
                        "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'cancelled', ?)",
                        [order.id, logMsg]
                    );

                    await connection.commit();
                    console.log(`   ✅ Order #${order.id}: Refund Success. Saldo added: ${order.total_price}`);
                } catch (err) {
                    await connection.rollback();
                    console.error(`   ❌ Error Refund Order #${order.id}:`, err.message);
                }
            }
        } else {
            console.log("[TASK 3] No orders require refund at this time.");
        }

    } catch (error) {
        console.error('--- [CRON GLOBAL ERROR] ---', error);
    } finally {
        connection.release();
        console.log(`--- [CRON FINISHED] ---\n`);
    }
});