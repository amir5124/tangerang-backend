const db = require('../config/db');
const { sendPushNotification } = require('../services/notificationService');

/**
 * HELPER: Pencairan Dana (Robust & Sinkron)
 * Mengupdate tabel wallets, wallet_transactions, dan users.saldo (Cache UI)
 */
const releaseFundsToMitra = async (connection, orderId) => {
    console.log(`\n[WALLET-LOG] 💰 Memulai proses release dana untuk Order #${orderId}`);

    // 1. Ambil detail biaya dan ID User Mitra
    const [order] = await connection.execute(
        `SELECT o.total_price, s.user_id as mitra_user_id 
         FROM orders o 
         JOIN stores s ON o.store_id = s.id 
         WHERE o.id = ?`, [orderId]
    );

    if (order.length === 0) {
        throw new Error(`[WALLET-ERROR] Order #${orderId} tidak ditemukan.`);
    }

    const { total_price, mitra_user_id } = order[0];
    const rawPrice = parseFloat(total_price) || 0;

    // HITUNG POTONGAN 30% (Sistem Komisi)
    const platformFee = rawPrice * 0.3;
    const netAmount = rawPrice - platformFee;

    console.log(`[WALLET-LOG] Kalkulasi: Gross Rp${rawPrice} | Fee(30%) Rp${platformFee} | Net Rp${netAmount}`);

    // 2. Sinkronisasi Tabel Wallets (Audit Finansial)
    const [walletCheck] = await connection.execute(
        "SELECT id FROM wallets WHERE user_id = ?", [mitra_user_id]
    );

    let walletId;
    if (walletCheck.length === 0) {
        console.log(`[WALLET-LOG] User #${mitra_user_id} belum punya wallet. Membuat baru...`);
        const [insertW] = await connection.execute(
            "INSERT INTO wallets (user_id, balance) VALUES (?, ?)", [mitra_user_id, netAmount]
        );
        walletId = insertW.insertId;
    } else {
        walletId = walletCheck[0].id;
        await connection.execute(
            "UPDATE wallets SET balance = balance + ? WHERE id = ?", [netAmount, walletId]
        );
    }

    // 3. Sinkronisasi Tabel Users (Cache Tampilan UI)
    console.log(`[WALLET-LOG] Sinkronisasi kolom users.saldo untuk Mitra #${mitra_user_id}`);
    await connection.execute(
        "UPDATE users SET saldo = saldo + ? WHERE id = ?", [netAmount, mitra_user_id]
    );

    // 4. Catat Riwayat Transaksi
    await connection.execute(
        `INSERT INTO wallet_transactions (wallet_id, amount, type, description) 
         VALUES (?, ?, 'credit', ?)`,
        [walletId, netAmount, `Penghasilan Order #${orderId} (Potongan 30%)`]
    );

    console.log(`[WALLET-LOG] ✅ Dana berhasil dicairkan secara sinkron.`);
    return netAmount;
};

// --- EXPORTS ---

/**
 * CREATE ORDER
 * Mencatat pesanan baru dan inisialisasi pembayaran pending
 */
exports.createOrder = async (req, res) => {
    console.log(`[DEBUG] createOrder: Request dari Customer #${req.body.customer_id}`);
    const {
        customer_id, store_id, metode_pembayaran, jenisGedung,
        jadwal, lokasi, rincian_biaya, layananTerpilih, catatan
    } = req.body;

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const sqlOrder = `INSERT INTO orders 
            (customer_id, store_id, scheduled_date, scheduled_time, building_type, address_customer, total_price, status, customer_notes) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`;

        const [orderResult] = await connection.execute(sqlOrder, [
            customer_id, store_id, jadwal.tanggal, jadwal.waktu, jenisGedung,
            lokasi.alamatLengkap, rincian_biaya.total_akhir, catatan
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
        console.log(`[DEBUG] Order #${newOrderId} Berhasil dibuat.`);
        res.status(201).json({ success: true, order_id: newOrderId });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error(`[ERROR] createOrder:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally { connection.release(); }
};

/**
 * GET ORDER DETAIL
 * Mengambil data lengkap order termasuk transformasi URL gambar bukti
 */
exports.getOrderDetail = async (req, res) => {
    const { id } = req.params;
    try {
        const sql = `
            SELECT o.*, u.full_name AS customer_name, u.phone_number AS customer_phone, u.fcm_token AS customer_fcm,
                m.full_name AS mitra_name, m.phone_number AS phone_number, m.fcm_token AS mitra_fcm,
                s.store_name,
                (SELECT rating FROM reviews WHERE order_id = o.id LIMIT 1) as already_rated,
                (SELECT JSON_ARRAYAGG(JSON_OBJECT('nama', service_name, 'qty', qty, 'hargaSatuan', price_satuan)) 
                 FROM order_items WHERE order_id = o.id) AS items
            FROM orders o 
            JOIN users u ON o.customer_id = u.id 
            JOIN stores s ON o.store_id = s.id 
            JOIN users m ON s.user_id = m.id 
            WHERE o.id = ?`;

        const [rows] = await db.execute(sql, [id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan' });

        const data = rows[0];

        // Format Path Gambar menjadi URL Absolut untuk App
        if (data.proof_image_url && !data.proof_image_url.startsWith('http')) {
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            data.proof_image_url = `${baseUrl}/${data.proof_image_url.replace(/\\/g, '/')}`;
        }

        res.status(200).json({ success: true, data });
    } catch (error) {
        console.error(`[ERROR] getOrderDetail #${id}:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * UPDATE ORDER STATUS (MITRA)
 * Digunakan mitra untuk mengupdate progress dan upload bukti foto
 */
exports.updateOrderStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // status dari FormData
    const connection = await db.getConnection();

    console.log(`\n[DEBUG] --- Update Status (Mitra) Order #${id} ---`);

    try {
        await connection.beginTransaction();

        // 1. Validasi Keberadaan Order
        const [orderData] = await connection.execute(
            `SELECT o.status, u.fcm_token, u.full_name FROM orders o 
             JOIN users u ON o.customer_id = u.id WHERE o.id = ?`, [id]
        );

        if (orderData.length === 0) throw new Error("Order tidak ditemukan");
        if (orderData[0].status === 'completed') throw new Error("Order sudah selesai.");

        // 2. Tangani Upload Gambar dari Multer (req.file)
        let query = "UPDATE orders SET status = ? WHERE id = ?";
        let params = [status, id];

        if (req.file) {
            // Path ini harus sesuai dengan destination di Multer (orderRoutes)
            const proofPath = `uploads/work_evidence/${req.file.filename}`;
            console.log(`[DEBUG] Bukti pengerjaan diterima: ${proofPath}`);
            query = "UPDATE orders SET status = ?, proof_image_url = ? WHERE id = ?";
            params = [status, proofPath, id];
        }

        await connection.execute(query, params);

        // 3. Catat Log Perubahan
        await connection.execute(
            "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, ?, ?)",
            [id, status, `Update status oleh mitra ke ${status}`]
        );

        await connection.commit();

        // 4. Notifikasi ke Customer
        if (orderData[0].fcm_token) {
            const statusMap = {
                'accepted': 'telah diterima teknisi',
                'on_the_way': 'dalam perjalanan ke lokasi',
                'working': 'mulai dikerjakan',
                'completed': 'telah selesai dikerjakan ✅'
            };
            const body = `Halo ${orderData[0].full_name}, pesanan Anda ${statusMap[status] || status}`;

            sendPushNotification(orderData[0].fcm_token, "Update Pesanan 🔔", body, {
                orderId: String(id),
                status: String(status)
            }).catch(e => console.error("FCM Notif Error:", e.message));
        }

        res.status(200).json({ success: true, message: `Status berhasil diubah ke ${status}` });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("🔥 Update Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally { connection.release(); }
};

/**
 * CUSTOMER COMPLETE ORDER
 * Customer mengonfirmasi selesai, memberi rating, dan mencairkan dana ke Mitra
 */
exports.customerCompleteOrder = async (req, res) => {
    const { id } = req.params;
    const { rating, comment, quality, punctuality, communication } = req.body;
    const connection = await db.getConnection();

    console.log(`\n[DEBUG] --- Konfirmasi Selesai (Customer) Order #${id} ---`);

    try {
        await connection.beginTransaction();

        const [orderData] = await connection.execute(
            "SELECT customer_id, store_id, status FROM orders WHERE id = ?", [id]
        );

        if (orderData.length === 0) throw new Error("Order tidak ditemukan");

        const { customer_id, store_id, status } = orderData[0];
        const isTransitionToComplete = (status !== 'completed');

        // 1. Simpan/Update Review
        await connection.execute(
            `INSERT INTO reviews (order_id, customer_id, store_id, rating, rating_quality, rating_punctuality, rating_communication, comment) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment)`,
            [id, customer_id, store_id, rating || 5, quality || 5, punctuality || 5, communication || 5, comment || ""]
        );

        // 2. Alur Pencairan Dana (Hanya Sekali)
        if (isTransitionToComplete) {
            await connection.execute("UPDATE orders SET status = 'completed' WHERE id = ?", [id]);

            // Jalankan Helper Pencairan Dana
            const netAmount = await releaseFundsToMitra(connection, id);

            // Notifikasi Dana Masuk ke Mitra
            const [mitra] = await connection.execute(
                `SELECT u.fcm_token FROM stores s JOIN users u ON s.user_id = u.id WHERE s.id = ?`, [store_id]
            );

            if (mitra[0]?.fcm_token) {
                sendPushNotification(
                    mitra[0].fcm_token,
                    "Dana Masuk! 💰",
                    `Order selesai. Rp${netAmount.toLocaleString()} masuk ke dompet Anda.`,
                    { type: 'WALLET_UPDATE', orderId: String(id) }
                ).catch(e => console.error("FCM Mitra Error:", e.message));
            }
        }

        // 3. Update Rating Agregat Toko
        await connection.execute(
            `UPDATE stores SET 
             average_rating = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE store_id = ?), 
             total_reviews = (SELECT COUNT(*) FROM reviews WHERE store_id = ?) 
             WHERE id = ?`, [store_id, store_id, store_id]
        );

        await connection.commit();
        res.status(200).json({ success: true, message: "Terima kasih! Ulasan telah disimpan." });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error(`[ERROR] customerCompleteOrder:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally { connection.release(); }
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

exports.internalReleaseFunds = releaseFundsToMitra;