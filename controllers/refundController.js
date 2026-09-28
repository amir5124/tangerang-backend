// /app/controllers/refundController.js
// ============================================================
// Refund oleh Admin (menggantikan refund manual lewat SQL)
//
// Prinsip anti-bug (belajar dari kasus order #413):
//  1. orders + payments + wallets + wallet_transactions + order_status_logs
//     diubah dalam SATU transaction.
//  2. payments.payment_status WAJIB jadi 'refund' di transaction yang sama,
//     supaya cron Task 3 tidak memproses ulang (double refund).
//  3. Row order & payment di-lock (FOR UPDATE) -> aman dari klik ganda
//     dan aman dari cron yang jalan bersamaan.
//  4. Nominal tidak boleh melebihi payments.gross_amount (uang yang
//     benar-benar dibayar customer).
// ============================================================

const db = require('../config/db');
const { sendToUser, sendToRole } = require('../services/notificationService');

const rupiah = (n) => `Rp${Number(n || 0).toLocaleString('id-ID')}`;

// ============================================================
// GET /refund/candidates
// Daftar order yang sudah dibayar (settlement) tapi belum direfund.
// - cancelled + settlement  -> "nyangkut", perlu direfund (mis. order #203)
// - order aktif + settlement -> admin masih bisa batalkan + refund
// Order 'completed' sengaja tidak dimasukkan (dana sudah cair ke mitra).
// ============================================================
exports.getRefundCandidates = async (req, res) => {
    const tag = '[getRefundCandidates]';
    try {
        const [rows] = await db.execute(
            `SELECT
                o.id AS order_id, o.status, o.cancelled_by, o.cancel_reason,
                o.total_price, o.platform_fee, o.service_fee, o.order_date,
                u.id AS customer_id, u.full_name AS customer_name, u.email AS customer_email,
                s.store_name,
                p.payment_status, p.gross_amount, p.transaction_time,
                (o.total_price + IFNULL(o.platform_fee, 0) + IFNULL(o.service_fee, 0)) AS refund_estimate
             FROM orders o
             JOIN payments p ON p.order_id = o.id
             JOIN users u    ON u.id = o.customer_id
             LEFT JOIN stores s ON s.id = o.store_id
             WHERE p.payment_status = 'settlement'
               AND o.status IN ('cancelled', 'pending', 'accepted', 'on_the_way', 'working')
             ORDER BY (o.status = 'cancelled') DESC, o.order_date DESC
             LIMIT 200`
        );

        res.json({ success: true, count: rows.length, data: rows });
    } catch (error) {
        console.error(`${tag} ❌ Error:`, error.message);
        res.status(500).json({ success: false, message: 'Gagal mengambil daftar refund', error: error.message });
    }
};

// ============================================================
// POST /refund/:orderId
// body: { reason: string (wajib), amount?: number }
// ============================================================
exports.adminRefundOrder = async (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    const { reason, amount } = req.body || {};
    const adminId = req.user?.id || null;
    const tag = `[adminRefundOrder][Order#${orderId}][Admin#${adminId}]`;

    if (!orderId || Number.isNaN(orderId)) {
        return res.status(400).json({ success: false, message: 'Order ID tidak valid' });
    }
    if (!reason || !String(reason).trim()) {
        return res.status(400).json({ success: false, message: 'Alasan refund wajib diisi' });
    }
    const cleanReason = String(reason).trim().slice(0, 200);

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Lock order
        const [orderRows] = await connection.execute(
            `SELECT o.id, o.customer_id, o.status, o.total_price, o.platform_fee, o.service_fee,
                    u.full_name AS customer_name
             FROM orders o
             JOIN users u ON u.id = o.customer_id
             WHERE o.id = ? FOR UPDATE`,
            [orderId]
        );
        if (orderRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }
        const order = orderRows[0];

        // 2. Lock payment(s)
        const [paymentRows] = await connection.execute(
            `SELECT id, payment_status, gross_amount FROM payments WHERE order_id = ? ORDER BY id DESC FOR UPDATE`,
            [orderId]
        );
        if (paymentRows.length === 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Data payment tidak ditemukan untuk order ini' });
        }
        const payment = paymentRows.find((p) => p.payment_status === 'settlement');
        if (!payment) {
            await connection.rollback();
            const statuses = paymentRows.map((p) => p.payment_status).join(', ');
            return res.status(400).json({
                success: false,
                message: `Order tidak bisa direfund. Status payment: ${statuses} (harus 'settlement').`,
            });
        }

        // 3. Guard: order selesai -> dana sudah/akan cair ke mitra
        if (order.status === 'completed') {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Order sudah completed. Refund harus ditangani manual (perlu penarikan dana dari mitra).',
            });
        }

        // 4. Guard: dana sudah dicairkan ke mitra?
        const [released] = await connection.execute(
            `SELECT id FROM wallet_transactions WHERE description LIKE ? LIMIT 1`,
            [`Penghasilan Order #${orderId} (%`]
        );
        if (released.length > 0) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Dana order ini sudah dicairkan ke mitra. Refund harus ditangani manual.',
            });
        }

        // 5. Hitung nominal refund (full refund), tidak boleh > yang dibayar
        const gross = parseFloat(payment.gross_amount) || 0;
        const formula =
            (parseFloat(order.total_price) || 0) +
            (parseFloat(order.platform_fee) || 0) +
            (parseFloat(order.service_fee) || 0);

        let refundAmount = Math.min(formula, gross);

        if (amount !== undefined && amount !== null && amount !== '') {
            const custom = parseFloat(amount);
            if (Number.isNaN(custom) || custom <= 0) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: 'Nominal refund tidak valid' });
            }
            if (custom > gross) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Nominal refund (${rupiah(custom)}) melebihi yang dibayar customer (${rupiah(gross)}).`,
                });
            }
            refundAmount = custom;
        }

        if (refundAmount <= 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Nominal refund 0, tidak ada yang bisa direfund' });
        }

        // 6. Update order
        await connection.execute(
            `UPDATE orders
             SET status = 'cancelled',
                 payment_status = 'refunded',
                 cancelled_by = COALESCE(cancelled_by, 'system'),
                 cancel_reason = ?
             WHERE id = ?`,
            [`[Refund Admin] ${cleanReason}`, orderId]
        );

        // 7. Update payments -> KUNCI anti double refund oleh cron Task 3
        await connection.execute(`UPDATE payments SET payment_status = 'refund' WHERE id = ?`, [payment.id]);

        // 8. Wallet customer (lock, buat jika belum ada)
        const [wallets] = await connection.execute(
            `SELECT id FROM wallets WHERE user_id = ? FOR UPDATE`,
            [order.customer_id]
        );

        let walletId;
        if (wallets.length === 0) {
            const [ins] = await connection.execute(
                `INSERT INTO wallets (user_id, balance) VALUES (?, ?)`,
                [order.customer_id, refundAmount]
            );
            walletId = ins.insertId;
        } else {
            walletId = wallets[0].id;
            await connection.execute(`UPDATE wallets SET balance = balance + ? WHERE id = ?`, [refundAmount, walletId]);
        }

        // 9. Catat mutasi wallet
        await connection.execute(
            `INSERT INTO wallet_transactions (wallet_id, amount, type, description) VALUES (?, ?, 'credit', ?)`,
            [walletId, refundAmount, `Refund Order #${orderId} oleh admin (ID ${adminId}) - ${cleanReason}`]
        );

        // 10. Catat log status order
        await connection.execute(
            `INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'cancelled', ?)`,
            [orderId, `Refund oleh admin (ID ${adminId}): ${rupiah(refundAmount)} ke wallet customer. Alasan: ${cleanReason}`]
        );

        await connection.commit();
        console.log(`${tag} ✅ Refund ${rupiah(refundAmount)} -> wallet #${walletId} (${order.customer_name})`);

        // 11. Notifikasi (di luar transaction, error tidak membatalkan refund)
        sendToUser(
            order.customer_id,
            '💸 Refund Berhasil',
            `Dana ${rupiah(refundAmount)} dari Order #${orderId} telah dikembalikan ke dompet Anda.`,
            { type: 'WALLET_UPDATE', orderId: String(orderId), screen: 'Wallet' }
        ).catch((e) => console.error(`${tag} ❌ Notif customer error:`, e.message));

        sendToRole(
            'admin',
            '💸 Refund Diproses',
            `Order #${orderId} direfund ${rupiah(refundAmount)} ke ${order.customer_name} oleh admin #${adminId}.`,
            { type: 'ADMIN_ORDER_ALERT', orderId: String(orderId), screen: 'OrderDetail' }
        ).catch((e) => console.error(`${tag} ❌ Notif admin error:`, e.message));

        res.json({
            success: true,
            message: 'Refund berhasil diproses',
            data: {
                order_id: orderId,
                customer_name: order.customer_name,
                refund_amount: refundAmount,
                wallet_id: walletId,
            },
        });
    } catch (error) {
        await connection.rollback();
        console.error(`${tag} ❌ Error:`, error.stack);
        res.status(500).json({ success: false, message: 'Gagal memproses refund', error: error.message });
    } finally {
        connection.release();
    }
};