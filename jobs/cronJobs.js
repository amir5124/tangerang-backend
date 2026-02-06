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
        const [expiredOrders] = await connection.execute(`
            SELECT id FROM orders 
            WHERE status = 'completed' 
            AND id NOT IN (SELECT CAST(SUBSTRING_INDEX(description, '#', -1) AS UNSIGNED) FROM wallet_transactions)
            AND TIMESTAMPDIFF(HOUR, order_date, NOW()) >= 24
        `);

        for (const order of expiredOrders) {
            await connection.beginTransaction();
            try {
                await internalReleaseFunds(connection, order.id);
                await connection.commit();
                console.log(`Successfully auto-released funds for Order #${order.id}`);
            } catch (err) {
                await connection.rollback();
                console.error(`Failed to auto-release Order #${order.id}`, err);
            }
        }
    } catch (error) {
        console.error('Cron Job Error:', error);
    } finally {
        connection.release();
    }
});