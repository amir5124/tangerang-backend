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
    const netAmount = (parseFloat(total_price) || 0) - (parseFloat(platform_fee) || 0);

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

        // 1. Ambil data Order & Customer FCM
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

        const customerFcm = orderData[0].fcm_token;
        const currentStatus = orderData[0].status;

        if (currentStatus === 'completed') {
            await connection.rollback();
            return res.status(400).json({ message: "Order sudah selesai." });
        }

        // 2. Update status ke Database
        await connection.execute("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
        await connection.execute(
            "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, ?, ?)",
            [id, status, `Status diperbarui ke ${status}`]
        );

        await connection.commit();

        // 3. Kirim Notifikasi (Penting: Format harus lengkap agar muncul di HP)
        if (customerFcm) {
            const statusMap = {
                'accepted': 'telah diterima oleh teknisi',
                'on_the_way': 'sedang menuju lokasi Anda 🛵',
                'working': 'sedang dikerjakan 🛠️',
                'completed': 'telah selesai dikerjakan ✅'
            };

            const title = "Update Pesanan 🔔";
            const body = `Halo ${orderData[0].full_name || 'Customer'}, pesanan Anda ${statusMap[status] || status}`;

            try {
                // Gunakan format payload yang memaksa sistem HP memunculkan notif
                await sendPushNotification(
                    customerFcm,
                    title,
                    body,
                    {
                        orderId: String(id),
                        type: "STATUS_UPDATE",
                        status: String(status),
                        click_action: "FLUTTER_NOTIFICATION_CLICK", // Jika menggunakan Flutter
                        sound: "default"
                    }
                );
                console.log(`✅ Notif [${status}] terkirim ke: ${orderData[0].full_name}`);
            } catch (fcmErr) {
                console.error("❌ FCM Error:", fcmErr.message);
            }
        }

        return res.status(200).json({ success: true, message: `Status menjadi ${status}` });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("🔥 Error:", error.message);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        connection.release();
    }
};
// Selesaikan dan Rating oleh CUSTOMER (Mencairkan Dana)
exports.customerCompleteOrder = async (req, res) => {
    const { id } = req.params; // ID Order
    const { rating, comment, quality, punctuality, communication } = req.body;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Ambil data order secara mendalam untuk validasi
        const [orderData] = await connection.execute(
            "SELECT customer_id, store_id, status FROM orders WHERE id = ?",
            [id]
        );

        if (orderData.length === 0) {
            throw new Error("Order tidak ditemukan");
        }

        const { customer_id, store_id, status } = orderData[0];
        const isAlreadyCompleted = status === 'completed';

        // 2. Normalisasi input rating agar selalu berupa angka (Integer)
        const finalRating = parseInt(rating) || 5;
        const q = parseInt(quality) || 5;
        const p = parseInt(punctuality) || 5;
        const c = parseInt(communication) || 5;

        // 3. Simpan atau Perbarui Review (Atomic Update)
        // UNIQUE(order_id) di database akan memicu bagian ON DUPLICATE KEY
        await connection.execute(
            `INSERT INTO reviews 
                (order_id, customer_id, store_id, rating, rating_quality, rating_punctuality, rating_communication, comment) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
                rating = VALUES(rating),
                rating_quality = VALUES(rating_quality),
                rating_punctuality = VALUES(rating_punctuality),
                rating_communication = VALUES(rating_communication),
                comment = VALUES(comment)`,
            [id, customer_id, store_id, finalRating, q, p, c, comment || ""]
        );

        // 4. Update Status Order menjadi 'completed'
        await connection.execute("UPDATE orders SET status = 'completed' WHERE id = ?", [id]);

        // 5. Update Rating Akumulatif di Tabel Stores
        await connection.execute(
            `UPDATE stores SET 
             average_rating = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE store_id = ?), 
             total_reviews = (SELECT COUNT(*) FROM reviews WHERE store_id = ?) 
             WHERE id = ?`,
            [store_id, store_id, store_id]
        );

        // 6. LOGIKA PENCAIRAN DANA YANG AMAN
        // Dana HANYA dicairkan jika ini adalah pertama kalinya order diselesaikan
        // Tambahkan ini di dalam blok "if (!isAlreadyCompleted)"
        if (!isAlreadyCompleted) {
            await releaseFundsToMitra(connection, id);

            // Kirim Notifikasi ke Mitra
            const [mitraInfo] = await connection.execute(
                `SELECT u.fcm_token FROM stores s 
         JOIN users u ON s.user_id = u.id 
         WHERE s.id = ?`, [store_id]
            );

            if (mitraInfo[0]?.fcm_token) {
                sendPushNotification(
                    mitraInfo[0].fcm_token,
                    "Dana Masuk! 💰",
                    `Penghasilan telah masuk ke dompet Anda.`,
                    {
                        type: 'WALLET_UPDATE', // Kunci agar app mitra refresh saldo
                        orderId: String(id)
                    }
                );
            }
        }

        await connection.commit();
        res.status(200).json({
            success: true,
            message: isAlreadyCompleted ? "Ulasan diperbarui." : "Pesanan selesai dan dana dicairkan."
        });

    } catch (error) {
        await connection.rollback();
        console.error("🔥 [Error customerCompleteOrder]:", error.message);
        res.status(500).json({
            success: false,
            message: "Gagal memproses ulasan",
            error: error.message
        });
    } finally {
        connection.release();
    }
};

exports.internalReleaseFunds = releaseFundsToMitra;