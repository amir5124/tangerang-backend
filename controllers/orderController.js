const fs = require('fs');
const db = require('../config/db');
const { sendPushNotification } = require('../services/notificationService');

/**
 * HELPER: Fungsi Internal untuk Pencairan Dana
 * UPDATE: Sekarang mendukung otomatis membuat wallet jika belum ada (Upsert)
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

    // --- PERHITUNGAN 70% ---
    // Menggunakan Math.floor untuk menghindari angka pecahan di saldo wallet
    const total = parseFloat(total_price) || 0;
    const netAmount = Math.floor(total * 0.7);
    const platformFeeAmount = total - netAmount; // Ini adalah 30% yang masuk ke platform

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
    // Tambahkan keterangan persentase agar mitra tidak bingung
    await connection.execute(
        "INSERT INTO wallet_transactions (wallet_id, amount, type, description) VALUES (?, ?, 'credit', ?)",
        [
            walletId,
            netAmount,
            `Penghasilan Order #${orderId} (Bagi hasil 70%)`
        ]
    );

    // OPTIONAL: Update platform_fee di tabel orders agar sesuai dengan kenyataan (30%)
    await connection.execute(
        "UPDATE orders SET platform_fee = ? WHERE id = ?",
        [platformFeeAmount, orderId]
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
    const { id } = req.params;
    console.log(`[DEBUG] Fetching Detail Order ID: ${id}`);

    try {
        const sql = `
            SELECT 
                o.*, 
                u.full_name AS customer_name, 
                u.phone_number AS customer_phone, 
                u.fcm_token AS customer_fcm,
                -- Alamat diambil dari tabel orders (o), bukan users (u)
                o.address_customer AS address_customer, 
                m.full_name AS mitra_name, 
                m.phone_number AS mitra_phone,
                s.store_name,
                -- Subquery Review
                (SELECT rating FROM reviews WHERE order_id = o.id LIMIT 1) as already_rated,
                -- Subquery Items
                (SELECT JSON_ARRAYAGG(
                    JSON_OBJECT('nama', service_name, 'qty', qty, 'hargaSatuan', price_satuan)
                 ) FROM order_items WHERE order_id = o.id) AS items
            FROM orders o 
            LEFT JOIN users u ON o.customer_id = u.id 
            LEFT JOIN stores s ON o.store_id = s.id 
            LEFT JOIN users m ON s.user_id = m.id 
            WHERE o.id = ?`;

        const [rows] = await db.execute(sql, [id]);

        if (rows.length === 0) {
            console.warn(`[DEBUG] Order ${id} not found.`);
            return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan' });
        }

        let data = rows[0];

        // Format Proof Image URL jika ada
        if (data.proof_image_url && !data.proof_image_url.startsWith('http')) {
            data.proof_image_url = `${req.protocol}://${req.get('host')}/${data.proof_image_url.replace(/\\/g, '/')}`;
        }

        console.log(`[DEBUG] Order ${id} loaded successfully.`);
        res.status(200).json({ success: true, data: data });

    } catch (error) {
        console.error("[ERROR] getOrderDetail:", error.message);
        res.status(500).json({
            success: false,
            message: "Internal Server Error",
            error: error.message
        });
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
    const { status } = req.body; // status diambil dari FormData body
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Ambil data order dan Customer FCM
        // Gunakan FOR UPDATE untuk mengunci baris agar tidak terjadi race condition
        const [orderData] = await connection.execute(
            `SELECT o.status, o.proof_image_url, u.fcm_token, u.full_name 
             FROM orders o 
             JOIN users u ON o.customer_id = u.id 
             WHERE o.id = ? FOR UPDATE`, [id]
        );

        if (orderData.length === 0) {
            // Jika order tidak ada, hapus file yang baru saja diupload oleh multer (jika ada)
            if (req.file) fs.unlinkSync(req.file.path);
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Order tidak ditemukan" });
        }

        const currentStatus = orderData[0].status;
        const customerFcm = orderData[0].fcm_token;

        // 2. Validasi: Jika sudah selesai/batal, jangan ijinkan update lagi
        if (['completed', 'cancelled'].includes(currentStatus)) {
            if (req.file) fs.unlinkSync(req.file.path);
            await connection.rollback();
            return res.status(400).json({ success: false, message: "Pesanan sudah bersifat final." });
        }

        // 3. Logika Upload Gambar
        let proofImageUrl = orderData[0].proof_image_url;
        if (req.file) {
            // Multer meletakkan file di req.file. 
            // Kita simpan path-nya (misal: uploads/work_evidence/finish-123.jpg)
            proofImageUrl = req.file.path.replace(/\\/g, '/');
        }

        // 4. Eksekusi Update ke Database
        if (status === 'completed') {
            // Opsional: Validasi wajib foto jika status 'completed'
            if (!proofImageUrl) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: "Foto bukti pengerjaan wajib diunggah." });
            }

            await connection.execute(
                "UPDATE orders SET status = ?, proof_image_url = ? WHERE id = ?",
                [status, proofImageUrl, id]
            );
        } else {
            await connection.execute(
                "UPDATE orders SET status = ? WHERE id = ?",
                [status, id]
            );
        }

        // 5. Catat Log Perubahan Status
        await connection.execute(
            "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, ?, ?)",
            [id, status, `Status diperbarui ke ${status} oleh mitra`]
        );

        // 6. Selesaikan Transaksi Database
        await connection.commit();

        // 7. Kirim Notifikasi ke Customer (Setelah commit berhasil)
        if (customerFcm) {
            const statusMap = {
                'accepted': 'telah diterima oleh teknisi',
                'on_the_way': 'sedang menuju lokasi Anda 🛵',
                'working': 'sedang dikerjakan 🛠️',
                'completed': 'telah selesai dikerjakan ✅'
            };

            const title = "Update Pesanan 🔔";
            const body = `Halo ${orderData[0].full_name}, pesanan Anda ${statusMap[status] || status}`;

            try {
                await sendPushNotification(
                    customerFcm,
                    title,
                    body,
                    {
                        orderId: String(id),
                        type: "ORDER_STATUS_UPDATE",
                        status: String(status)
                    }
                );
            } catch (fcmErr) {
                console.error("❌ FCM Error:", fcmErr.message);
            }
        }

        return res.status(200).json({
            success: true,
            message: `Status berhasil diperbarui ke ${status}`,
            data: {
                orderId: id,
                status: status,
                proof_image_url: proofImageUrl
            }
        });

    } catch (error) {
        // Jika terjadi error, batalkan semua perubahan database
        if (connection) await connection.rollback();

        // Hapus file fisik yang gagal diproses agar tidak memenuhi storage
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error("Gagal menghapus file sampah:", err);
            });
        }

        console.error("🔥 Error Update Status:", error);
        res.status(500).json({ success: false, error: error.message });
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
        // 6. LOGIKA PENCAIRAN DANA YANG AMAN
        if (!isAlreadyCompleted) {
            // Cairkan dana (70% seperti yang kita buat sebelumnya)
            await releaseFundsToMitra(connection, id);

            // Cari Token FCM Mitra dan hitung nominal untuk notifikasi
            // Kita JOIN stores dengan users untuk mendapatkan fcm_token milik pemilik toko
            const [mitraData] = await connection.execute(
                `SELECT u.fcm_token, o.total_price 
             FROM orders o
             JOIN stores s ON o.store_id = s.id
             JOIN users u ON s.user_id = u.id
             WHERE o.id = ?`,
                [id]
            );

            if (mitraData.length > 0 && mitraData[0].fcm_token) {
                const fcmToken = mitraData[0].fcm_token;
                const total = parseFloat(mitraData[0].total_price);
                const pendapatanMitra = Math.floor(total * 0.7); // 70%

                // Format Rupiah untuk notifikasi
                const formattedAmount = new Intl.NumberFormat('id-ID', {
                    style: 'currency',
                    currency: 'IDR',
                    maximumFractionDigits: 0
                }).format(pendapatanMitra);

                try {
                    await sendPushNotification(
                        fcmToken,
                        "Dana Masuk! 💰",
                        `Selamat! Pendapatan ${formattedAmount} dari Order #${id} telah masuk ke dompet Anda.`,
                        {
                            type: 'WALLET_UPDATE',
                            orderId: String(id),
                            amount: String(pendapatanMitra),
                            click_action: "FLUTTER_NOTIFICATION_CLICK"
                        }
                    );
                    console.log(`✅ Notif dana masuk terkirim ke mitra untuk Order #${id}`);
                } catch (notifError) {
                    console.error("❌ Gagal mengirim notifikasi ke mitra:", notifError.message);
                    // Kita tidak melakukan rollback jika hanya notifikasi yang gagal
                }
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