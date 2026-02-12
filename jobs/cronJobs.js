const cron = require('node-cron');
const db = require('../config/db');
const { internalReleaseFunds } = require('../controllers/orderController');

// Berjalan setiap jam (0 * * * *)
cron.schedule('0 * * * *', async () => {
    console.log('Running Auto-Release Funds Job...');
    const connection = await db.getConnection();

    try {
        // Cari order yang 'completed' tapi belum cair dan sudah lewat 24 jam
        // Indikator belum cair: tidak ada history 'credit' di wallet_transactions untuk order ini
        // Ganti query expiredOrders di Cron Job menjadi ini:
        // Query ini mencari order yang sudah dikerjakan (working) tapi dicuekin pelanggan > 24 jam
        const [expiredOrders] = await connection.execute(`
    SELECT id FROM orders 
    WHERE status = 'working' 
    AND proof_image_url IS NOT NULL
    AND updated_at <= NOW() - INTERVAL 24 HOUR
`);

        for (const order of expiredOrders) {
            await connection.beginTransaction();
            try {
                // 1. UPDATE STATUS TERLEBIH DAHULU agar tidak terdeteksi cron lagi di jam berikutnya
                await connection.execute(
                    "UPDATE orders SET status = 'completed' WHERE id = ?",
                    [order.id]
                );

                // 2. Cairkan Dana
                await internalReleaseFunds(connection, order.id);

                await connection.commit();
                console.log(`[CRON] Sukses Auto-Complete Order #${order.id}`);
            } catch (err) {
                await connection.rollback();
                console.error(`[CRON-ERROR] Order #${order.id}:`, err);
            }
        }
    } catch (error) {
        console.error('Cron Job Error:', error);
    } finally {
        connection.release();
    }
});