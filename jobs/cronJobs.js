const cron = require('node-cron');
const db = require('../config/db');
const { internalReleaseFunds } = require('../controllers/orderController');
const { sendToUser } = require('../services/notificationService');

cron.schedule('*/5 * * * *', async () => {
    const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    let connection;

    try {
        connection = await db.getConnection();

        let headerLogged = false;
        const logHeader = () => {
            if (!headerLogged) {
                console.log(`\n${'═'.repeat(60)}`);
                console.log(`  [CRON START] ${timestamp} WIB`);
                console.log(`${'═'.repeat(60)}`);
                headerLogged = true;
            }
        };

        // ─────────────────────────────────────────────────────────
        // TASK 1: AUTO-CANCEL EXPIRED PAYMENTS
        // ─────────────────────────────────────────────────────────
        const [expiredPayments] = await connection.execute(`
            SELECT p.order_id, p.transaction_id, p.expired_at
            FROM payments p
            WHERE p.payment_status = 'pending'
            AND p.expired_at IS NOT NULL
            AND p.expired_at <= NOW()
        `);

        if (expiredPayments.length > 0) {
            logHeader();
            console.log(`\n  [TASK 1] AUTO-CANCEL EXPIRED PAYMENTS`);
            console.log(`  Found: ${expiredPayments.length} expired payment(s)`);
            console.log(`  ${'─'.repeat(50)}`);

            for (const pay of expiredPayments) {
                await connection.beginTransaction();
                try {
                    // Guard: cek ulang status payment sebelum update
                    const [recheck] = await connection.execute(
                        "SELECT payment_status FROM payments WHERE transaction_id = ? FOR UPDATE",
                        [pay.transaction_id]
                    );
                    if (!recheck[0] || recheck[0].payment_status !== 'pending') {
                        await connection.rollback();
                        console.log(`  ⚠️  Order #${pay.order_id}: Payment sudah diproses, skip.`);
                        continue;
                    }

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
                    console.log(`  ✅ Order #${pay.order_id}: Expired & cancelled. (expired_at: ${pay.expired_at})`);
                } catch (err) {
                    await connection.rollback();
                    console.error(`  ❌ Task 1 Error #${pay.order_id}:`, err.message);
                }
            }
        }

        // ─────────────────────────────────────────────────────────
        // TASK 2: AUTO-COMPLETE (CONFIRMATION TIMEOUT 24 JAM)
        // ─────────────────────────────────────────────────────────
        const [expiredWork] = await connection.execute(`
            SELECT
                o.id, o.customer_id, o.store_id, o.updated_at,
                TIMESTAMPDIFF(HOUR, o.updated_at, NOW()) AS jam_berlalu,
                s.user_id AS mitra_user_id,
                s.store_name,
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
            console.log(`\n  [TASK 2] AUTO-COMPLETE TIMEOUT 24 JAM`);
            console.log(`  Found: ${expiredWork.length} order(s) untuk auto-completion`);
            console.log(`  ${'─'.repeat(50)}`);

            for (const order of expiredWork) {
                await connection.beginTransaction();
                try {
                    // Guard race condition
                    const [check] = await connection.execute(
                        "SELECT status FROM orders WHERE id = ? FOR UPDATE",
                        [order.id]
                    );
                    if (!check[0] || check[0].status !== 'working') {
                        await connection.rollback();
                        console.log(`  ⚠️  Order #${order.id}: Status bukan working (${check[0]?.status}), skip.`);
                        continue;
                    }

                    console.log(`  ⏳ Order #${order.id}: Memproses... (${order.jam_berlalu} jam sejak update, customer: ${order.customer_name})`);

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

                    if (releaseResult && releaseResult.netAmount) {
                        const formatted = new Intl.NumberFormat('id-ID', {
                            style: 'currency', currency: 'IDR', maximumFractionDigits: 0
                        }).format(releaseResult.netAmount);

                        console.log(`  ✅ Order #${order.id}: Auto-completed.`);
                        console.log(`     Toko    : ${order.store_name}`);
                        console.log(`     Dana    : ${formatted} → Wallet Mitra`);
                        console.log(`     Update  : ${order.updated_at} UTC (${order.jam_berlalu} jam lalu)`);

                        // Notif mitra
                        sendToUser(
                            releaseResult.mitra_user_id,
                            '💰 Dana Otomatis Cair!',
                            `Order #${order.id} otomatis selesai. Dana ${formatted} masuk ke dompet Anda.`,
                            { type: 'WALLET_UPDATE', orderId: String(order.id), screen: 'Wallet' }
                        ).catch(e => console.error(`  ❌ Notif mitra error #${order.id}:`, e.message));

                        // Notif customer
                        sendToUser(
                            order.customer_id,
                            '✅ Pesanan Otomatis Selesai',
                            `Pesanan #${order.id} otomatis diselesaikan sistem setelah 24 jam. Terima kasih!`,
                            { type: 'ORDER_STATUS_UPDATE', orderId: String(order.id), screen: 'OrderDetail' }
                        ).catch(e => console.error(`  ❌ Notif customer error #${order.id}:`, e.message));

                    } else {
                        console.log(`  ⚠️  Order #${order.id}: Completed tapi dana sudah pernah cair sebelumnya (skip release).`);
                    }

                } catch (err) {
                    await connection.rollback();
                    console.error(`  ❌ Task 2 Error #${order.id}:`, err.message);
                }
            }
        }

        // ─────────────────────────────────────────────────────────
        // TASK 3: UNIFIED REFUND SYSTEM
        // ─────────────────────────────────────────────────────────
        const [refundQueue] = await connection.execute(`
            SELECT o.id, o.customer_id, o.store_id, o.total_price,
                   o.platform_fee, o.service_fee, o.cancelled_by,
                   s.user_id AS mitra_user_id,
                   u.full_name AS customer_name
            FROM orders o
            JOIN payments p ON o.id = p.order_id
            JOIN stores s   ON o.store_id = s.id
            JOIN users u    ON o.customer_id = u.id
            WHERE o.status = 'cancelled'
            AND p.payment_status = 'settlement'
            AND p.payment_status != 'refund'
            AND o.cancelled_by IS NOT NULL
        `);

        if (refundQueue.length > 0) {
            logHeader();
            console.log(`\n  [TASK 3] UNIFIED REFUND SYSTEM`);
            console.log(`  Found: ${refundQueue.length} refund(s) to process`);
            console.log(`  ${'─'.repeat(50)}`);

            for (const order of refundQueue) {
                await connection.beginTransaction();
                try {
                    // Guard double refund dengan FOR UPDATE
                    const [check] = await connection.execute(
                        "SELECT payment_status FROM payments WHERE order_id = ? FOR UPDATE",
                        [order.id]
                    );
                    if (!check[0] || check[0].payment_status === 'refund') {
                        await connection.rollback();
                        console.log(`  ⚠️  Order #${order.id}: Sudah direfund, skip.`);
                        continue;
                    }
                    if (check[0].payment_status !== 'settlement') {
                        await connection.rollback();
                        console.log(`  ⚠️  Order #${order.id}: Payment status '${check[0].payment_status}', bukan settlement. Skip.`);
                        continue;
                    }

                    const baseAmount = parseFloat(order.total_price) || 0;
                    const platformFee = parseFloat(order.platform_fee) || 0;
                    const serviceFee = parseFloat(order.service_fee) || 0;

                    let refundToCustomer = 0;
                    let penaltyToMitra = 0;
                    let refundNote = '';

                    if (order.cancelled_by === 'customer') {
                        refundToCustomer = baseAmount + platformFee;
                        refundNote = 'Refund (Customer Cancel): Total + Platform Fee. Biaya transaksi ditanggung user.';
                    } else if (order.cancelled_by === 'mitra') {
                        refundToCustomer = baseAmount + platformFee + serviceFee;
                        penaltyToMitra = serviceFee;
                        refundNote = 'Refund (Mitra Cancel): Full Refund. Biaya transaksi dipotong dari saldo mitra.';
                    } else {
                        // system
                        refundToCustomer = baseAmount + platformFee + serviceFee;
                        refundNote = 'Refund (System): Full Refund ditanggung aplikator.';
                    }

                    // Cek wallet customer
                    const [wallets] = await connection.execute(
                        "SELECT id, balance FROM wallets WHERE user_id = ?",
                        [order.customer_id]
                    );
                    if (wallets.length === 0) throw new Error(`Customer wallet not found (UID: ${order.customer_id})`);

                    const walletId = wallets[0].id;
                    const saldoLama = parseFloat(wallets[0].balance);
                    const saldoBaru = saldoLama + refundToCustomer;

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
                        console.log(`  🔻 Penalty Mitra UID ${order.mitra_user_id}: -Rp${penaltyToMitra.toLocaleString('id-ID')}`);
                    }

                    await connection.execute(
                        "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'cancelled', ?)",
                        [order.id, refundNote]
                    );

                    await connection.commit();

                    console.log(`  ✅ Order #${order.id}: Refund berhasil.`);
                    console.log(`     Customer  : ${order.customer_name}`);
                    console.log(`     Cancel by : ${order.cancelled_by.toUpperCase()}`);
                    console.log(`     Refund    : Rp${refundToCustomer.toLocaleString('id-ID')} (saldo: Rp${saldoLama.toLocaleString('id-ID')} → Rp${saldoBaru.toLocaleString('id-ID')})`);
                    if (penaltyToMitra > 0) {
                        console.log(`     Penalty   : Rp${penaltyToMitra.toLocaleString('id-ID')} dipotong dari mitra`);
                    }

                    // Notif customer
                    sendToUser(
                        order.customer_id,
                        '💸 Refund Berhasil',
                        `Dana Rp${refundToCustomer.toLocaleString('id-ID')} dari Order #${order.id} telah dikembalikan ke dompet Anda.`,
                        { type: 'WALLET_UPDATE', orderId: String(order.id), screen: 'Wallet' }
                    ).catch(e => console.error(`  ❌ Notif refund error #${order.id}:`, e.message));

                } catch (err) {
                    await connection.rollback();
                    console.error(`  ❌ Task 3 Error #${order.id}:`, err.message);
                }
            }
        }

        if (headerLogged) {
            console.log(`\n${'═'.repeat(60)}`);
            console.log(`  [CRON END] ${timestamp} WIB`);
            console.log(`${'═'.repeat(60)}\n`);
        }

    } catch (error) {
        console.error(`\n${'═'.repeat(60)}`);
        console.error(`  [CRON GLOBAL ERROR] ${timestamp}`);
        console.error(`  ${error.message}`);
        console.error(`${'═'.repeat(60)}\n`);
    } finally {
        if (connection) connection.release();
    }
});