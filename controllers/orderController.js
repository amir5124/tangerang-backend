const fs = require('fs');
const db = require('../config/db');
const { sendPushNotification } = require('../services/notificationService');

/**
 * HELPER: Fungsi Internal untuk Pencairan Dana
 * UPDATE: Sekarang mendukung otomatis membuat wallet jika belum ada (Upsert)
 */
const releaseFundsToMitra = async (connection, orderId) => {
    // 1. CEK EKSTRIM: Pastikan order ini BELUM PERNAH mencairkan dana
    // Cari di history transaksi berdasarkan description unik
    const [existingTx] = await connection.execute(
        "SELECT id FROM wallet_transactions WHERE description LIKE ?",
        [`%Order #${orderId}%`]
    );

    if (existingTx.length > 0) {
        console.log(`[PREVENT] Order #${orderId} sudah pernah dicairkan. Menghentikan proses.`);
        return false; // Beritahu pemanggil bahwa tidak ada dana yang dicairkan
    }

    // 2. Ambil detail biaya dan ID User Mitra
    const [order] = await connection.execute(
        `SELECT o.total_price, s.user_id as mitra_user_id 
         FROM orders o 
         JOIN stores s ON o.store_id = s.id 
         WHERE o.id = ?`, [orderId]
    );

    if (order.length === 0) return false;
    const { total_price, mitra_user_id } = order[0];

    const total = parseFloat(total_price) || 0;
    const netAmount = Math.floor(total * 0.7);
    const platformFeeAmount = total - netAmount;

    // 3. Update Saldo (Upsert)
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

    // 4. Catat history (Ini adalah bukti final agar tidak double)
    await connection.execute(
        "INSERT INTO wallet_transactions (wallet_id, amount, type, description) VALUES (?, ?, 'credit', ?)",
        [walletId, netAmount, `Penghasilan Order #${orderId} (Bagi hasil 70%)`]
    );

    await connection.execute(
        "UPDATE orders SET platform_fee = ? WHERE id = ?",
        [platformFeeAmount, orderId]
    );

    return netAmount; // Kembalikan angka untuk kebutuhan notifikasi
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
    const { status } = req.body; // Status yang dikirim dari aplikasi Mitra
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Ambil data order & info pelanggan (Lock row untuk konsistensi)
        const [orderData] = await connection.execute(
            `SELECT o.status, o.proof_image_url, u.fcm_token, u.full_name 
             FROM orders o 
             JOIN users u ON o.customer_id = u.id 
             WHERE o.id = ? FOR UPDATE`, [id]
        );

        if (orderData.length === 0) {
            if (req.file) fs.unlinkSync(req.file.path);
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Order tidak ditemukan" });
        }

        const currentStatus = orderData[0].status;
        const customerFcm = orderData[0].fcm_token;
        const customerName = orderData[0].full_name;

        // 2. Validasi status final (Jika sudah completed/cancelled tidak boleh diubah lagi)
        if (['completed', 'cancelled'].includes(currentStatus)) {
            if (req.file) fs.unlinkSync(req.file.path);
            await connection.rollback();
            return res.status(400).json({ success: false, message: "Pesanan sudah bersifat final." });
        }

        // 3. Penanganan gambar bukti kerja
        let proofImageUrl = orderData[0].proof_image_url;
        if (req.file) {
            proofImageUrl = req.file.path.replace(/\\/g, '/');
        }

        // 4. LOGIKA MAPPING STATUS (DIPERBAIKI)
        let statusToSave = status;
        let responseMessage = `Status berhasil diperbarui ke ${status}`;

        if (status === 'completed') {
            // Mitra klik "Selesai", tapi kita jangan set 'completed' di DB.
            // Kita biarkan status tetap 'working' agar dana TIDAK cair otomatis.
            // Keberadaan proof_image_url akan membuat order ini muncul di "Menunggu Konfirmasi" pada dashboard.
            if (!req.file && !proofImageUrl) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: "Bukti foto wajib diunggah untuk menyelesaikan pekerjaan." });
            }
            statusToSave = 'working';
            responseMessage = "Laporan pengerjaan terkirim. Menunggu konfirmasi pelanggan untuk pencairan dana.";
        }

        // 5. Eksekusi Update ke Database
        await connection.execute(
            "UPDATE orders SET status = ?, proof_image_url = ? WHERE id = ?",
            [statusToSave, proofImageUrl, id]
        );

        // 6. Simpan Log Aktivitas
        const logNotes = status === 'completed'
            ? `Mitra melaporkan pekerjaan selesai (Menunggu konfirmasi)`
            : `Status diperbarui ke ${status} oleh mitra`;

        await connection.execute(
            "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, ?, ?)",
            [id, statusToSave, logNotes]
        );

        await connection.commit();

        // 7. RESPON KE CLIENT (Mitra)
        res.status(200).json({
            success: true,
            message: responseMessage,
            data: { orderId: id, status: statusToSave, proof_image_url: proofImageUrl }
        });

        // 8. PROSES NOTIFIKASI FCM (Background Process)
        if (customerFcm) {
            const statusMap = {
                'accepted': 'telah diterima oleh teknisi',
                'on_the_way': 'sedang menuju lokasi Anda ',
                'working': 'sedang dikerjakan ',
                'completed': 'telah selesai dikerjakan dan menunggu konfirmasi Anda ✅'
            };

            const title = "Update Pesanan 🔔";
            const body = `Halo ${customerName}, pesanan Anda ${statusMap[status] || status}`;

            sendPushNotification(customerFcm, title, body, {
                orderId: String(id),
                type: "ORDER_STATUS_UPDATE",
                status: String(statusToSave)
            }).catch(err => console.error("❌ Background FCM Error:", err.message));
        }

    } catch (error) {
        if (connection) await connection.rollback();
        if (req.file) fs.unlinkSync(req.file.path);

        console.error("🔥 Error Update Status:", error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: "Terjadi kesalahan pada server.", error: error.message });
        }
    } finally {
        connection.release();
    }
};
// Selesaikan dan Rating oleh CUSTOMER (Mencairkan Dana)
exports.customerCompleteOrder = async (req, res) => {
    const { id } = req.params;
    const { rating, comment, quality, punctuality, communication } = req.body;
    const connection = await db.getConnection();

    console.log(`\n[DEBUG] === Memulai Proses Konfirmasi Order #${id} ===`);
    console.log(`[DEBUG] Payload: Rating=${rating}, Comment=${comment}`);

    try {
        await connection.beginTransaction();

        // 1. Cek status awal
        const [orderData] = await connection.execute(
            "SELECT customer_id, store_id, status FROM orders WHERE id = ?",
            [id]
        );

        if (orderData.length === 0) {
            console.error(`[DEBUG] Order #${id} tidak ditemukan di database.`);
            throw new Error("Order tidak ditemukan");
        }

        const { customer_id, store_id, status: currentStatus } = orderData[0];
        console.log(`[DEBUG] Status saat ini di DB: ${currentStatus}`);

        // 2. Simpan atau Perbarui Review
        console.log(`[DEBUG] Mencoba menyimpan/update review untuk Order #${id}...`);
        await connection.execute(
            `INSERT INTO reviews 
                (order_id, customer_id, store_id, rating, rating_quality, rating_punctuality, rating_communication, comment) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
                rating = VALUES(rating), comment = VALUES(comment)`,
            [id, customer_id, store_id, parseInt(rating) || 5, parseInt(quality) || 5, parseInt(punctuality) || 5, parseInt(communication) || 5, comment || ""]
        );

        // 3. ATOMIC UPDATE (Pencegahan Duplikasi Saldo)
        console.log(`[DEBUG] Menjalankan Atomic Update status ke 'completed'...`);
        const [updateResult] = await connection.execute(
            "UPDATE orders SET status = 'completed' WHERE id = ? AND status != 'completed'",
            [id]
        );

        console.log(`[DEBUG] affectedRows hasil update status: ${updateResult.affectedRows}`);

        // 4. Update Rating Toko
        await connection.execute(
            `UPDATE stores SET 
             average_rating = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE store_id = ?), 
             total_reviews = (SELECT COUNT(*) FROM reviews WHERE store_id = ?) 
             WHERE id = ?`,
            [store_id, store_id, store_id]
        );

        // 5. PENCAIRAN DANA
        if (updateResult.affectedRows > 0) {
            console.log(`[DEBUG] SUCCESS: Ini adalah konfirmasi pertama. Memanggil releaseFundsToMitra...`);
            const amountCair = await releaseFundsToMitra(connection, id);

            if (amountCair) {
                console.log(`[DEBUG] Dana berhasil dicairkan: Rp${amountCair}`);

                const [mitra] = await connection.execute(
                    `SELECT u.fcm_token FROM stores s JOIN users u ON s.user_id = u.id WHERE s.id = ?`,
                    [store_id]
                );

                if (mitra[0]?.fcm_token) {
                    const formatted = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amountCair);
                    sendPushNotification(mitra[0].fcm_token, "Dana Masuk! 💰", `Selamat! Pendapatan ${formatted} dari Order #${id} masuk ke dompet.`, { type: 'WALLET_UPDATE', orderId: String(id) })
                        .then(() => console.log(`[DEBUG] Notifikasi dana masuk terkirim ke Mitra.`))
                        .catch(e => console.error("[DEBUG] Gagal kirim FCM:", e.message));
                }
            } else {
                console.warn(`[DEBUG] releaseFundsToMitra tidak mengembalikan nominal (Mungkin sudah pernah cair).`);
            }
        } else {
            console.log(`[DEBUG] IGNORED: Order #${id} sudah berstatus 'completed' sebelumnya. Dana tidak dicairkan lagi.`);
        }

        await connection.commit();
        console.log(`[DEBUG] === Transaksi Order #${id} Berhasil di-Commit ===\n`);

        res.status(200).json({
            success: true,
            message: updateResult.affectedRows > 0 ? "Pesanan selesai & dana dicairkan." : "Ulasan diperbarui."
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error(`\n[DEBUG-ERROR] Terjadi error pada Order #${id}:`, error.message);
        res.status(500).json({ success: false, message: "Gagal memproses", error: error.message });
    } finally {
        if (connection) connection.release();
    }
};

exports.internalReleaseFunds = releaseFundsToMitra;