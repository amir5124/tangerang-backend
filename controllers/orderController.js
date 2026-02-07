const db = require('../config/db');
const { sendPushNotification } = require('../services/notificationService');

/**
 * HELPER: Fungsi Internal untuk Pencairan Dana
 * UPDATE: Sekarang mendukung otomatis membuat wallet jika belum ada (Upsert)
 */
const releaseFundsToMitra = async (connection, orderId) => {
    // 1. Ambil detail biaya dan ID User Mitra langsung dari tabel stores
    const [order] = await connection.execute(
        `SELECT o.total_price, o.platform_fee, s.user_id as mitra_user_id 
         FROM orders o 
         JOIN stores s ON o.store_id = s.id 
         WHERE o.id = ?`, [orderId]
    );

    if (order.length === 0) return;
    const { total_price, platform_fee, mitra_user_id } = order[0];

    // Net amount yang diterima mitra (Total - Biaya Aplikasi)
    const netAmount = parseFloat(total_price) - parseFloat(platform_fee);

    // 2. CEK / BUAT WALLET (Upsert Logic)
    // Cek apakah wallet sudah ada
    const [walletCheck] = await connection.execute(
        "SELECT id FROM wallets WHERE user_id = ?",
        [mitra_user_id]
    );

    let walletId;

    if (walletCheck.length === 0) {
        // Jika tidak ada, buat wallet baru
        const [insertWallet] = await connection.execute(
            "INSERT INTO wallets (user_id, balance) VALUES (?, ?)",
            [mitra_user_id, netAmount]
        );
        walletId = insertWallet.insertId;
    } else {
        // Jika ada, update saldo yang sudah ada
        await connection.execute(
            "UPDATE wallets SET balance = balance + ? WHERE user_id = ?",
            [netAmount, mitra_user_id]
        );
        walletId = walletCheck[0].id;
    }

    // 3. Catat history transaksi wallet
    await connection.execute(
        "INSERT INTO wallet_transactions (wallet_id, amount, type, description) VALUES (?, ?, 'credit', ?)",
        [walletId, netAmount, `Penghasilan Order #${orderId}`]
    );
};

// --- EXPORTS ---

exports.createOrder = async (req, res) => {
    const {
        customer_id, store_id, metode_pembayaran, jenisGedung,
        jadwal, lokasi, rincian_biaya, layananTerpilih, catatan
    } = req.body;

    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        const sqlOrder = `INSERT INTO orders 
            (customer_id, store_id, scheduled_date, scheduled_time, building_type, address_customer, total_price, platform_fee, service_fee, status, customer_notes) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`;

        const [orderResult] = await connection.execute(sqlOrder, [
            customer_id, store_id, jadwal.tanggal, jadwal.waktu, jenisGedung,
            lokasi.alamatLengkap, rincian_biaya.subtotal_layanan,
            rincian_biaya.biaya_layanan_app, rincian_biaya.biaya_transaksi, catatan
        ]);

        const newOrderId = orderResult.insertId;
        const sqlItem = `INSERT INTO order_items (order_id, service_name, qty, price_satuan, subtotal) VALUES (?, ?, ?, ?, ?)`;
        for (const item of layananTerpilih) {
            await connection.execute(sqlItem, [newOrderId, item.nama, item.qty, item.hargaSatuan, (item.qty * item.hargaSatuan)]);
        }

        const method = metode_pembayaran === 'QRIS' ? 'midtrans' : 'manual_transfer';
        await connection.execute(
            `INSERT INTO payments (order_id, customer_id, payment_method, gross_amount, payment_status) VALUES (?, ?, ?, ?, 'pending')`,
            [newOrderId, customer_id, method, rincian_biaya.total_akhir]
        );

        await connection.commit();
        res.status(201).json({ success: true, order_id: newOrderId });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ success: false, error: error.message });
    } finally { connection.release(); }
};

exports.getOrderDetail = async (req, res) => {
    try {
        const { id } = req.params;
        const sql = `
            SELECT 
                o.*, 
                o.proof_image_url,
                u.full_name AS customer_name, 
                u.phone_number AS customer_phone, 
                u.fcm_token AS customer_fcm,
                m.full_name AS mitra_name, 
                m.phone_number AS phone_number,
                m.fcm_token AS mitra_fcm,
                s.store_name,
                (SELECT rating FROM reviews WHERE order_id = o.id LIMIT 1) as already_rated,
                (SELECT JSON_ARRAYAGG(
                    JSON_OBJECT('nama', service_name, 'qty', qty, 'hargaSatuan', price_satuan)
                 ) FROM order_items WHERE order_id = o.id) AS items
            FROM orders o 
            JOIN users u ON o.customer_id = u.id 
            JOIN stores s ON o.store_id = s.id 
            JOIN users m ON s.user_id = m.id 
            WHERE o.id = ?`;

        const [rows] = await db.execute(sql, [id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan' });

        if (rows[0].proof_image_url && !rows[0].proof_image_url.startsWith('http')) {
            rows[0].proof_image_url = `${req.protocol}://${req.get('host')}/${rows[0].proof_image_url.replace(/\\/g, '/')}`;
        }

        res.status(200).json({ success: true, data: rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getUserOrders = async (req, res) => {
    try {
        const { userId } = req.params;
        const sql = `
            SELECT o.id, o.status, o.total_price, o.scheduled_date, o.scheduled_time, o.order_date, s.store_name as mitra_name 
            FROM orders o
            JOIN stores s ON o.store_id = s.id
            WHERE o.customer_id = ?
            ORDER BY o.order_date DESC`;
        const [rows] = await db.execute(sql, [userId]);
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.updateOrderStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [orderData] = await connection.execute(
            `SELECT u.fcm_token, m.full_name as mitra_name FROM orders o 
             JOIN users u ON o.customer_id = u.id JOIN stores s ON o.store_id = s.id
             JOIN users m ON s.user_id = m.id WHERE o.id = ?`, [id]
        );

        await connection.execute("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
        if (status === 'completed' && req.file) {
            await connection.execute("UPDATE orders SET proof_image_url = ? WHERE id = ?", [req.file.path, id]);
        }

        await connection.execute("INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, ?, ?)",
            [id, status, `Status diperbarui oleh mitra`]);

        await connection.commit();

        if (orderData[0]?.fcm_token) {
            sendPushNotification(orderData[0].fcm_token, "Update Pesanan", `Status pesanan Anda kini: ${status}`, { orderId: id });
        }
        res.status(200).json({ success: true });
    } catch (error) { await connection.rollback(); res.status(500).json({ error: error.message }); }
    finally { connection.release(); }
};

// Selesaikan dan Rating oleh CUSTOMER (Mencairkan Dana)
exports.customerCompleteOrder = async (req, res) => {
    const { id } = req.params;
    const { rating, comment, quality, punctuality, communication } = req.body;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Ambil data order & validasi
        const [orderData] = await connection.execute("SELECT customer_id, store_id, status FROM orders WHERE id = ?", [id]);
        if (orderData.length === 0) throw new Error("Order tidak ditemukan");

        // Jika status sudah completed, mungkin review sudah ada, tapi kita izinkan lanjut untuk update rating jika perlu
        const { customer_id, store_id } = orderData[0];

        // 2. Simpan ke tabel reviews (Gunakan COALESCE/Default value)
        const finalRating = parseInt(rating) || 5;
        const q = parseInt(quality) || 5;
        const p = parseInt(punctuality) || 5;
        const c = parseInt(communication) || 5;

        await connection.execute(
            `INSERT INTO reviews (order_id, customer_id, store_id, rating, rating_quality, rating_punctuality, rating_communication, comment) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE rating = ?, comment = ?`,
            [id, customer_id, store_id, finalRating, q, p, c, comment || "", finalRating, comment || ""]
        );

        // 3. Update Status Order ke Completed
        await connection.execute("UPDATE orders SET status = 'completed' WHERE id = ?", [id]);

        // 4. Update Store Rating (Rata-rata)
        await connection.execute(
            `UPDATE stores 
             SET average_rating = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE store_id = ?), 
                 total_reviews = (SELECT COUNT(*) FROM reviews WHERE store_id = ?) 
             WHERE id = ?`,
            [store_id, store_id, store_id]
        );

        // 5. CAIRKAN DANA KE WALLET MITRA (Sudah aman dengan fitur Auto-Create Wallet)
        await releaseFundsToMitra(connection, id);

        await connection.commit();
        res.status(200).json({ success: true, message: "Pesanan selesai & rating tersimpan." });
    } catch (error) {
        await connection.rollback();
        console.error("🔥 Error Rating & Completion:", error.message);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        connection.release();
    }
};

exports.internalReleaseFunds = releaseFundsToMitra;