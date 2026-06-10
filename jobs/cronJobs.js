const cron = require('node-cron');
const db = require('../config/db');
const { internalReleaseFunds } = require('../controllers/orderController');
const { sendToUser } = require('../services/notificationService');

cron.schedule('*/5 * * * *', async () => {
    const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Makassar' });
    let connection;

    try {
        connection = await db.getConnection();

        let headerLogged = false;
        const logHeader = () => {
            if (!headerLogged) {
                console.log(`\n--- [CRON START: ${timestamp}] ---`);
                headerLogged = true;
            }
        };

        // ─────────────────────────────────────────────────────────
        // TASK 1: AUTO-CANCEL EXPIRED PAYMENTS
        // ─────────────────────────────────────────────────────────
        const [expiredPayments] = await connection.execute(`
            SELECT p.order_id, p.transaction_id 
            FROM payments p 
            WHERE p.payment_status = 'pending' 
            AND p.expired_at <= NOW()
        `);

        if (expiredPayments.length > 0) {
            logHeader();
            console.log(`[TASK 1] Found ${expiredPayments.length} expired payments.`);

            for (const pay of expiredPayments) {
                await connection.beginTransaction();
                try {
                    await connection.execute(
                        "UPDATE payments SET payment_status = 'expire' WHERE transaction_id = ?",
                        [pay.transaction_id]
                    );
                    await connection.execute(
                        "UPDATE orders SET status = 'cancelled', cancelled_by = 'system' WHERE id = ? AND status NOT IN ('completed', 'cancelled')",
                        [pay.order_id]
                    );
                    await connection.execute(
                        "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'cancelled', 'Payment expired (System)')",
                        [pay.order_id]
                    );
                    await connection.commit();
                    console.log(`   ✅ Order #${pay.order_id}: Expired & cancelled.`);
                } catch (err) {
                    await connection.rollback();
                    console.error(`   ❌ Task 1 Error #${pay.order_id}:`, err.message);
                }
            }
        }

        // ─────────────────────────────────────────────────────────
        // TASK 2: AUTO-COMPLETE (CONFIRMATION TIMEOUT 24 JAM)
        // ─────────────────────────────────────────────────────────
        const [expiredWork] = await connection.execute(`
            SELECT 
                o.id, o.customer_id, o.store_id,
                s.user_id AS mitra_user_id,
                u.full_name AS customer_name
            FROM orders o
            JOIN stores s ON o.store_id = s.id
            JOIN users u  ON o.customer_id = u.id
            WHERE o.status = 'working' 
            AND o.proof_image_url IS NOT NULL
            AND o.updated_at <= NOW() - INTERVAL 24 HOUR
        `);

        if (expiredWork.length > 0) {
            logHeader();
            console.log(`[TASK 2] Found ${expiredWork.length} orders for auto-completion.`);

            for (const order of expiredWork) {
                await connection.beginTransaction();
                try {
                    // Cek belum completed (guard race condition)
                    const [check] = await connection.execute(
                        "SELECT status FROM orders WHERE id = ? FOR UPDATE",
                        [order.id]
                    );
                    if (!check[0] || check[0].status === 'completed') {
                        await connection.rollback();
                        console.log(`   ⚠️  Order #${order.id}: Sudah completed, skip.`);
                        continue;
                    }

                    await connection.execute(
                        "UPDATE orders SET status = 'completed' WHERE id = ?",
                        [order.id]
                    );

                    // Insert review default jika belum ada
                    await connection.execute(`
                        INSERT IGNORE INTO reviews 
                            (order_id, customer_id, store_id, rating,
                             rating_quality, rating_punctuality, rating_communication, comment)
                        VALUES (?, ?, ?, 5, 5, 5, 5, 'Auto-completed by system')
                    `, [order.id, order.customer_id, order.store_id]);

                    // Update rating toko
                    await connection.execute(`
                        UPDATE stores SET
                            average_rating = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE store_id = ?),
                            total_reviews  = (SELECT COUNT(*) FROM reviews WHERE store_id = ?)
                        WHERE id = ?
                    `, [order.store_id, order.store_id, order.store_id]);

                    await connection.execute(
                        "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'completed', 'Auto-completed by system (24h timeout)')",
                        [order.id]
                    );

                    const releaseResult = await internalReleaseFunds(connection, order.id);

                    await connection.commit();
                    console.log(`   ✅ Order #${order.id}: Auto-completed & dana cair.`);

                    // Notif setelah commit
                    if (releaseResult && releaseResult.netAmount) {
                        const formatted = new Intl.NumberFormat('id-ID', {
                            style: 'currency', currency: 'IDR', maximumFractionDigits: 0
                        }).format(releaseResult.netAmount);

                        sendToUser(
                            releaseResult.mitra_user_id,
                            '💰 Dana Otomatis Cair!',
                            `Order #${order.id} otomatis selesai. Dana ${formatted} masuk ke dompet Anda.`,
                            { type: 'WALLET_UPDATE', orderId: String(order.id), screen: 'Wallet' }
                        ).catch(e => console.error(`   ❌ Notif mitra error:`, e.message));

                        sendToUser(
                            order.customer_id,
                            '✅ Pesanan Otomatis Selesai',
                            `Pesanan #${order.id} otomatis diselesaikan sistem setelah 24 jam.`,
                            { type: 'ORDER_STATUS_UPDATE', orderId: String(order.id), screen: 'OrderDetail' }
                        ).catch(e => console.error(`   ❌ Notif customer error:`, e.message));
                    }

                } catch (err) {
                    await connection.rollback();
                    console.error(`   ❌ Task 2 Error #${order.id}:`, err.message);
                }
            }
        }

        // ─────────────────────────────────────────────────────────
        // TASK 3: UNIFIED REFUND SYSTEM
        // ─────────────────────────────────────────────────────────
        const [refundQueue] = await connection.execute(`
            SELECT o.id, o.customer_id, o.store_id, o.total_price, 
                   o.platform_fee, o.service_fee, o.cancelled_by,
                   s.user_id AS mitra_user_id
            FROM orders o
            JOIN payments p ON o.id = p.order_id
            JOIN stores s   ON o.store_id = s.id
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
                    const [check] = await connection.execute(
                        "SELECT payment_status FROM payments WHERE order_id = ? FOR UPDATE",
                        [order.id]
                    );
                    if (!check[0] || check[0].payment_status === 'refund') {
                        await connection.rollback();
                        console.log(`   ⚠️  Order #${order.id}: Sudah direfund, skip.`);
                        continue;
                    }

                    const baseAmount = parseFloat(order.total_price);
                    const platformFee = parseFloat(order.platform_fee || 0);
                    const serviceFee = parseFloat(order.service_fee || 0);

                    let refundToCustomer = 0;
                    let penaltyToMitra = 0;
                    let refundNote = "";

                    if (order.cancelled_by === 'customer') {
                        refundToCustomer = baseAmount + platformFee;
                        refundNote = "Refund (Customer Cancel): Total + Platform Fee. Biaya transaksi ditanggung user.";
                    } else if (order.cancelled_by === 'mitra') {
                        refundToCustomer = baseAmount + platformFee + serviceFee;
                        penaltyToMitra = serviceFee;
                        refundNote = "Refund (Mitra Cancel): Full Refund. Biaya transaksi dipotong dari saldo mitra.";
                    } else {
                        refundToCustomer = baseAmount + platformFee + serviceFee;
                        refundNote = "Refund (System): Full Refund ditanggung aplikator.";
                    }

                    const [wallets] = await connection.execute(
                        "SELECT id FROM wallets WHERE user_id = ?",
                        [order.customer_id]
                    );
                    if (wallets.length === 0) throw new Error(`Customer wallet not found (UID: ${order.customer_id})`);

                    const walletId = wallets[0].id;

                    await connection.execute(
                        "UPDATE payments SET payment_status = 'refund' WHERE order_id = ?",
                        [order.id]
                    );
                    await connection.execute(
                        "UPDATE wallets SET balance = balance + ? WHERE id = ?",
                        [refundToCustomer, walletId]
                    );
                    await connection.execute(
                        "INSERT INTO wallet_transactions (wallet_id, amount, type, description) VALUES (?, ?, 'credit', ?)",
                        [walletId, refundToCustomer, `Refund Otomatis Order #${order.id} (${order.cancelled_by})`]
                    );

                    if (penaltyToMitra > 0) {
                        await connection.execute(
                            "UPDATE users SET saldo = saldo - ? WHERE id = ?",
                            [penaltyToMitra, order.mitra_user_id]
                        );
                        console.log(`   [PENALTY] Order #${order.id}: Mitra UID ${order.mitra_user_id} dipotong Rp${penaltyToMitra}`);
                    }

                    await connection.execute(
                        "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'cancelled', ?)",
                        [order.id, refundNote]
                    );

                    await connection.commit();
                    console.log(`   ✅ Order #${order.id}: Refund Rp${refundToCustomer} → Customer (by ${order.cancelled_by.toUpperCase()}).`);

                    // Notif customer
                    sendToUser(
                        order.customer_id,
                        '💸 Refund Berhasil',
                        `Dana Rp${refundToCustomer.toLocaleString('id-ID')} dari Order #${order.id} telah dikembalikan ke dompet Anda.`,
                        { type: 'WALLET_UPDATE', orderId: String(order.id), screen: 'Wallet' }
                    ).catch(e => console.error(`   ❌ Notif refund error:`, e.message));

                } catch (err) {
                    await connection.rollback();
                    console.error(`   ❌ Task 3 Error #${order.id}:`, err.message);
                }
            }
        }

        if (headerLogged) {
            console.log(`--- [CRON END] ---\n`);
        }

    } catch (error) {
        console.error('--- [CRON GLOBAL ERROR] ---', error.message);
    } finally {
        if (connection) connection.release();
    }
});