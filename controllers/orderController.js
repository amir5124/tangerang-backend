const db = require('../config/db');
const { sendPushNotification } = require('../services/notificationService');

/**
 * HELPER: Fungsi Internal untuk Pencairan Dana
 * LOGIKA: 70% untuk Mitra, 30% dipotong (Platform Fee)
 */
const releaseFundsToMitra = async (connection, orderId) => {
    // 1. Ambil detail biaya dan ID User Mitra
    const [order] = await connection.execute(
        `SELECT o.total_price, s.user_id as mitra_user_id 
         FROM orders o 
         JOIN stores s ON o.store_id = s.id 
         WHERE o.id = ?`, [orderId]
    );

    if (order.length === 0) return;
    const { total_price, mitra_user_id } = order[0];

    // HITUNG: 70% untuk Mitra
    const netAmount = (parseFloat(total_price) || 0) * 0.7;

    // 2. CEK / BUAT WALLET (Upsert Logic)
    const [walletCheck] = await connection.execute(
        "SELECT id FROM wallets WHERE user_id = ?",
        [mitra_user_id]
    );

    let walletId;
    if (walletCheck.length === 0) {
        const [insertWallet] = await connection.execute(
            "INSERT INTO wallets (user_id, balance) VALUES (?, ?)",
            [mitra_user_id, netAmount]
        );
        walletId = insertWallet.insertId;
    } else {
        await connection.execute(
            "UPDATE wallets SET balance = balance + ? WHERE user_id = ?",
            [netAmount, mitra_user_id]
        );
        walletId = walletCheck[0].id;
    }

    // 3. Catat history transaksi wallet
    await connection.execute(
        "INSERT INTO wallet_transactions (wallet_id, amount, type, description) VALUES (?, ?, 'credit', ?)",
        [walletId, netAmount, `Penghasilan Order #${orderId} (70%)`]
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

        // Fix Path Gambar untuk Mobile
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

/**
 * Update Status dari Mitra
 * Mendukung Upload Gambar (Multipart/form-data)
 */
exports.updateOrderStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [orderData] = await connection.execute(
            `SELECT o.status, u.fcm_token, u.full_name 
             FROM orders o 
             JOIN users u ON o.customer_id = u.id 
             WHERE o.id = ?`, [id]
        );

        if (orderData.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: "Order tidak ditemukan" });
        }

        if (orderData[0].status === 'completed') {
            await connection.rollback();
            return res.status(400).json({ message: "Order sudah selesai." });
        }

        // Logic Gambar: Jika ada file dari multer
        let sqlUpdate = "UPDATE orders SET status = ? WHERE id = ?";
        let sqlParams = [status, id];

        if (req.file) {
            // Path yang disimpan: uploads/proofs/nama-file.jpg
            const proofPath = `uploads/proofs/${req.file.filename}`;
            sqlUpdate = "UPDATE orders SET status = ?, proof_image_url = ? WHERE id = ?";
            sqlParams = [status, proofPath, id];
        }

        await connection.execute(sqlUpdate, sqlParams);
        await connection.execute(
            "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, ?, ?)",
            [id, status, `Status diperbarui ke ${status} ${req.file ? '(Bukti Foto diunggah)' : ''}`]
        );

        await connection.commit();

        // Notifikasi ke Customer
        const customerFcm = orderData[0].fcm_token;
        if (customerFcm) {
            const statusMap = {
                'accepted': 'telah diterima oleh teknisi',
                'on_the_way': 'sedang menuju lokasi Anda',
                'working': 'sedang dikerjakan',
                'completed': 'telah selesai dikerjakan ✅'
            };

            const title = "Update Pesanan 🔔";
            const body = `Halo ${orderData[0].full_name}, pesanan Anda ${statusMap[status] || status}`;

            sendPushNotification(customerFcm, title, body, {
                orderId: String(id),
                type: "ORDER_UPDATE",
                status: String(status)
            });
        }

        return res.status(200).json({ success: true, message: `Status menjadi ${status}` });
    } catch (error) {
        if (connection) await connection.rollback();
        res.status(500).json({ success: false, error: error.message });
    } finally {
        connection.release();
    }
};

/**
 * Konfirmasi Selesai oleh Customer
 * Mencairkan 70% dana ke Mitra
 */
exports.customerCompleteOrder = async (req, res) => {
    const { id } = req.params;
    const { rating, comment, quality, punctuality, communication } = req.body;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [orderData] = await connection.execute(
            "SELECT customer_id, store_id, status FROM orders WHERE id = ?",
            [id]
        );

        if (orderData.length === 0) throw new Error("Order tidak ditemukan");

        const { customer_id, store_id, status } = orderData[0];

        // PENCEGAHAN DOUBLE TRANSFER: Dana hanya cair jika status belum 'completed'
        const isAlreadyCompleted = (status === 'completed');

        // 1. Simpan Review
        await connection.execute(
            `INSERT INTO reviews 
                (order_id, customer_id, store_id, rating, rating_quality, rating_punctuality, rating_communication, comment) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment)`,
            [id, customer_id, store_id, parseInt(rating) || 5, parseInt(quality) || 5, parseInt(punctuality) || 5, parseInt(communication) || 5, comment || ""]
        );

        // 2. Update Status Order
        await connection.execute("UPDATE orders SET status = 'completed' WHERE id = ?", [id]);

        // 3. Update Rating Store
        await connection.execute(
            `UPDATE stores SET 
             average_rating = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE store_id = ?), 
             total_reviews = (SELECT COUNT(*) FROM reviews WHERE store_id = ?) 
             WHERE id = ?`,
            [store_id, store_id, store_id]
        );

        // 4. PENCAIRAN DANA (70%)
        if (!isAlreadyCompleted) {
            await releaseFundsToMitra(connection, id);

            // Ambil Token Mitra untuk Notifikasi
            const [mitraInfo] = await connection.execute(
                `SELECT u.fcm_token, u.full_name FROM stores s 
                 JOIN users u ON s.user_id = u.id 
                 WHERE s.id = ?`, [store_id]
            );

            if (mitraInfo[0]?.fcm_token) {
                await sendPushNotification(
                    mitraInfo[0].fcm_token,
                    "Dana Masuk! 💰",
                    `Halo ${mitraInfo[0].full_name}, pelanggan telah mengonfirmasi selesai. Dana 70% telah diteruskan ke dompet Anda.`,
                    {
                        type: 'WALLET_UPDATE',
                        orderId: String(id)
                    }
                );
            }
        }

        await connection.commit();
        res.status(200).json({
            success: true,
            message: isAlreadyCompleted ? "Ulasan diperbarui." : "Pesanan selesai dan dana 70% dicairkan."
        });

    } catch (error) {
        await connection.rollback();
        res.status(500).json({ success: false, error: error.message });
    } finally {
        connection.release();
    }
};

exports.internalReleaseFunds = releaseFundsToMitra;