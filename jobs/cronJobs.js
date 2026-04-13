const cron = require('node-cron');
const db = require('../config/db');
const { internalReleaseFunds } = require('../controllers/orderController');

cron.schedule('*/5 * * * *', async () => {
    const timestamp = new Date().toLocaleString('id-ID');
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
            console.log(`\n--- [CRON START: ${timestamp}] ---`);
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
         * TASK 2: AUTO-COMPLETE
         */
        const [expiredWork] = await connection.execute(`
            SELECT id FROM orders 
            WHERE status = 'working' 
            AND proof_image_url IS NOT NULL
            AND updated_at <= DATE_ADD(NOW(), INTERVAL 7 HOUR) - INTERVAL 24 HOUR
        `);

        if (expiredWork.length > 0) {
            if (expiredPayments.length === 0) console.log(`\n--- [CRON START: ${timestamp}] ---`);
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
                    console.error(`   ❌ Error Task 2 #${order.id}:`, err.message);
                }
            }
        }

        /**
         * TASK 3: AUTO-REFUND
         */
        const [noResponseOrders] = await connection.execute(`
            SELECT o.id, o.customer_id, o.total_price, o.platform_fee 
            FROM orders o
            JOIN payments p ON o.id = p.order_id
            WHERE o.status = 'pending' 
            AND p.payment_status = 'settlement' 
            AND o.updated_at <= DATE_ADD(NOW(), INTERVAL 7 HOUR) - INTERVAL 1 HOUR 
        `);

        if (noResponseOrders.length > 0) {
            if (expiredPayments.length === 0 && expiredWork.length === 0) console.log(`\n--- [CRON START: ${timestamp}] ---`);
            console.log(`[TASK 3] Found ${noResponseOrders.length} orders for refund.`);
            for (const order of noResponseOrders) {
                const totalRefund = parseFloat(order.total_price) + parseFloat(order.platform_fee || 0);
                await connection.beginTransaction();
                try {
                    const [check] = await connection.execute("SELECT payment_status FROM payments WHERE order_id = ? FOR UPDATE", [order.id]);
                    if (!check[0] || check[0].payment_status === 'refund') {
                        await connection.rollback();
                        continue;
                    }
                    const [wallets] = await connection.execute("SELECT id FROM wallets WHERE user_id = ?", [order.customer_id]);
                    if (wallets.length === 0) throw new Error(`Wallet not found for user ${order.customer_id}`);

                    const walletId = wallets[0].id;
                    await connection.execute("UPDATE orders SET status = 'cancelled' WHERE id = ?", [order.id]);
                    await connection.execute("UPDATE payments SET payment_status = 'refund' WHERE order_id = ?", [order.id]);
                    await connection.execute("UPDATE wallets SET balance = balance + ? WHERE id = ?", [totalRefund, walletId]);
                    await connection.execute("INSERT INTO wallet_transactions (wallet_id, amount, type, description) VALUES (?, ?, 'credit', ?)", [walletId, totalRefund, `Refund otomatis Order #${order.id}`]);
                    await connection.execute("INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'cancelled', ?)", [order.id, `Refund otomatis Rp${totalRefund.toLocaleString('id-ID')}`]);
                    await connection.commit();
                    console.log(`   ✅ Order #${order.id}: Refunded Rp${totalRefund}.`);
                } catch (err) {
                    await connection.rollback();
                    console.error(`   ❌ Error Task 3 #${order.id}:`, err.message);
                }
            }
        }

        /**
         * TASK 4: AUTO-PENALTY (DIPINDAHKAN KE DALAM TRY)
         */
        const [penaltyOrders] = await connection.execute(`
            SELECT o.id, o.service_fee, s.user_id AS mitra_user_id, s.store_name
            FROM orders o
            JOIN stores s ON o.store_id = s.id
            WHERE o.status = 'cancelled' 
            AND o.service_fee > 0
            AND EXISTS (
                SELECT 1 FROM order_status_logs 
                WHERE order_id = o.id 
                AND notes LIKE '%oleh mitra%' 
                AND notes NOT LIKE '%Penalty Applied%'
            )
        `);

        if (penaltyOrders.length > 0) {
            // Cek variabel dari Task sebelumnya untuk header log
            if (expiredPayments.length === 0 && expiredWork.length === 0 && noResponseOrders.length === 0) {
                console.log(`\n--- [CRON START: ${timestamp}] ---`);
            }
            console.log(`[TASK 4] Found ${penaltyOrders.length} orders for PG Admin penalty.`);

            for (const order of penaltyOrders) {
                await connection.beginTransaction();
                try {
                    const penaltyAmount = parseFloat(order.service_fee);
                    await connection.execute("UPDATE users SET saldo = saldo - ? WHERE id = ?", [penaltyAmount, order.mitra_user_id]);
                    await connection.execute("INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'cancelled', ?)", [order.id, `Penalty Applied: Rp${penaltyAmount.toLocaleString('id-ID')} (Service Fee PG)`]);
                    await connection.commit();
                    console.log(`   ✅ Order #${order.id}: Penalty Applied to ${order.store_name}.`);
                } catch (err) {
                    await connection.rollback();
                    console.error(`   ❌ Error Task 4 #${order.id}:`, err.message);
                }
            }
        }

    } catch (error) {
        console.error('--- [CRON GLOBAL ERROR] ---', error);
    } finally {
        // Dilepas sekali di akhir setelah semua Task selesai
        connection.release();
    }
});