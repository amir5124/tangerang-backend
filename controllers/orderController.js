const fs = require('fs');
const db = require('../config/db');
const { sendPushNotification } = require('../services/notificationService');

/**
 * HELPER: Fungsi Internal untuk Pencairan Dana
 * UPDATE: Sekarang mendukung otomatis membuat wallet jika belum ada (Upsert)
 */
const releaseFundsToMitra = async (connection, orderId) => {
    console.log(`[DEBUG] === Memulai Proses Pencairan Dana Order #${orderId} ===`);

    // 1. Cek duplikasi transaksi
    const [existingTx] = await connection.execute(
        "SELECT id FROM wallet_transactions WHERE description LIKE ?",
        [`%Order #${orderId}%`]
    );

    if (existingTx.length > 0) {
        console.warn(`[DEBUG] [PREVENT] Order #${orderId} sudah pernah dicairkan sebelumnya.`);
        return false;
    }

    // 2. Ambil data order lengkap termasuk platform_fee dan service_fee awal
    const [order] = await connection.execute(
        `SELECT o.total_price, o.discount_amount, o.platform_fee, o.service_fee, s.user_id as mitra_user_id 
         FROM orders o 
         JOIN stores s ON o.store_id = s.id 
         WHERE o.id = ?`, [orderId]
    );

    if (order.length === 0) {
        console.error(`[DEBUG] [ERROR] Order #${orderId} tidak ditemukan.`);
        return false;
    }

    const { 
        total_price, 
        discount_amount, 
        platform_fee, 
        service_fee, 
        mitra_user_id 
    } = order[0];

    // --- LOGIKA PERHITUNGAN BARU ---
    const paidByCustomer = parseFloat(total_price) || 0;
    const discountVal = parseFloat(discount_amount) || 0;
    const pFeeAwal = parseFloat(platform_fee) || 0;
    const sFeeAwal = parseFloat(service_fee) || 0;

    // Harga Jasa Murni = (Total Bayar + Diskon) - (Semua Biaya Admin/Layanan)
    // Kita kembalikan nilai diskon ke total kotor agar mitra tidak rugi karena voucher platform
    const grossOriginal = paidByCustomer + discountVal; 
    const pureServiceValue = grossOriginal - pFeeAwal - sFeeAwal;

    // Mitra mendapatkan 70% dari Harga Jasa Murni
    const netAmount = Math.floor(pureServiceValue * 0.7);

    // Total pendapatan aplikasi: (pFeeAwal + sFeeAwal) + (30% dari pureServiceValue) - discountVal (jika platform menanggung diskon)
    // Namun kita tidak melakukan UPDATE ke platform_fee agar nilai record tetap asli.

    console.log(`[DEBUG] Rincian Dana Order #${orderId}:
    - Paid by Customer      : Rp${paidByCustomer.toLocaleString()}
    - Discount Applied      : Rp${discountVal.toLocaleString()}
    - Platform Fee (Awal)   : Rp${pFeeAwal.toLocaleString()}
    - Service Fee (Awal)    : Rp${sFeeAwal.toLocaleString()}
    --------------------------------------------------
    - Gross Original        : Rp${grossOriginal.toLocaleString()}
    - Pure Service Value    : Rp${pureServiceValue.toLocaleString()} (Dasar Bagi Hasil)
    - Net to Mitra (70%)    : Rp${netAmount.toLocaleString()}
    --------------------------------------------------`);

    // 3. Update atau Buat Wallet Mitra
    const [walletCheck] = await connection.execute(
        "SELECT id FROM wallets WHERE user_id = ?", [mitra_user_id]
    );

    let walletId;
    if (walletCheck.length === 0) {
        console.log(`[DEBUG] Wallet tidak ditemukan. Membuat wallet baru untuk UID: ${mitra_user_id}`);
        const [insertWallet] = await connection.execute(
            "INSERT INTO wallets (user_id, balance) VALUES (?, ?)",
            [mitra_user_id, netAmount]
        );
        walletId = insertWallet.insertId;
    } else {
        console.log(`[DEBUG] Update saldo wallet ID: ${walletCheck[0].id}`);
        await connection.execute(
            "UPDATE wallets SET balance = balance + ? WHERE user_id = ?",
            [netAmount, mitra_user_id]
        );
        walletId = walletCheck[0].id;
    }

    // 4. Catat Transaksi Wallet
    await connection.execute(
        "INSERT INTO wallet_transactions (wallet_id, amount, type, description) VALUES (?, ?, 'credit', ?)",
        [walletId, netAmount, `Penghasilan Order #${orderId} (70% dari jasa Rp${pureServiceValue.toLocaleString()})`]
    );

    // 5. SELESAI: Kita TIDAK melakukan UPDATE ke orders SET platform_fee agar nilai tetap asli sesuai awal order.

    console.log(`[DEBUG] === Pencairan Dana Selesai untuk Order #${orderId} ===`);
    return netAmount;
};

exports.createOrder = async (req, res) => {
    const {
        customer_id, store_id, metode_pembayaran, jenisGedung,
        jadwal, lokasi, rincian_biaya, layananTerpilih, catatan, voucher_code
    } = req.body;

    console.log(`[DEBUG] === Incoming Request: Create Order ===`);
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        let discountAmount = 0;
        let appliedVoucherId = null;

        if (voucher_code) {
            // 1. Ambil data voucher termasuk usage_limit
            const [vouchers] = await connection.execute(
                "SELECT * FROM vouchers WHERE code = ? AND is_active = 1 AND (expired_at > NOW() OR expired_at IS NULL)",
                [voucher_code]
            );

            if (vouchers.length > 0) {
                const v = vouchers[0];

                // 2. Hitung jumlah penggunaan oleh user ini
                const [usageResult] = await connection.execute(
                    "SELECT COUNT(*) as total_usage FROM voucher_usages WHERE voucher_id = ? AND user_id = ?",
                    [v.id, customer_id]
                );

                const currentUsage = usageResult[0].total_usage;
                const limit = v.usage_limit || 1; // Fallback ke 1 jika null

                // 3. Perubahan Logika: Cek apakah masih di bawah limit
                if (currentUsage < limit) {
                    appliedVoucherId = v.id;
                    discountAmount = Math.floor(rincian_biaya.subtotal_layanan * (v.discount_percent / 100));

                    if (v.max_discount_amount && discountAmount > v.max_discount_amount) {
                        discountAmount = parseFloat(v.max_discount_amount);
                    }
                    console.log(`[DEBUG] Voucher Applied: ${v.code} (Usage: ${currentUsage + 1}/${limit}), Amount: Rp${discountAmount}`);
                } else {
                    console.warn(`[DEBUG] Voucher ${v.code} mencapai limit untuk user ${customer_id} (${currentUsage}/${limit})`);
                }
            } else {
                console.warn(`[DEBUG] Voucher ${voucher_code} tidak valid/aktif/expired`);
            }
        }

        const finalTotalPrice = rincian_biaya.total_akhir - discountAmount;

        // 4. Simpan Order (Pastikan kolom discount_amount tersedia di tabel orders)
        const sqlOrder = `INSERT INTO orders 
            (customer_id, store_id, scheduled_date, scheduled_time, building_type, 
             address_customer, lat_customer, lng_customer, total_price, 
             platform_fee, service_fee, status, customer_notes, items, voucher_id, discount_amount) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?)`;

        const [orderResult] = await connection.execute(sqlOrder, [
            customer_id, store_id, jadwal.tanggal, jadwal.waktu, jenisGedung,
            lokasi.alamatLengkap, lokasi.latitude, lokasi.longitude, finalTotalPrice,
            rincian_biaya.biaya_layanan_app, rincian_biaya.biaya_transaksi,
            catatan || null, JSON.stringify(layananTerpilih), appliedVoucherId, discountAmount
        ]);

        const newOrderId = orderResult.insertId;

        // 5. Catat penggunaan voucher ke history
        if (appliedVoucherId) {
            await connection.execute(
                "INSERT INTO voucher_usages (voucher_id, user_id, order_id) VALUES (?, ?, ?)",
                [appliedVoucherId, customer_id, newOrderId]
            );
        }

        // 6. Simpan item & log pembayaran
        const sqlItem = `INSERT INTO order_items (order_id, service_name, qty, price_satuan, subtotal) VALUES (?, ?, ?, ?, ?)`;
        for (const item of layananTerpilih) {
            await connection.execute(sqlItem, [newOrderId, item.nama, item.qty, item.hargaSatuan, (item.qty * item.hargaSatuan)]);
        }

        await connection.execute(
            "INSERT INTO payments (order_id, customer_id, payment_method, gross_amount, payment_status) VALUES (?, ?, ?, ?, 'pending')",
            [newOrderId, customer_id, metode_pembayaran, finalTotalPrice]
        );

        await connection.execute(
            "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'unpaid', 'Pesanan dibuat')",
            [newOrderId]
        );

        await connection.commit();

        // RESPONSE API: Sekarang menyertakan detail diskon agar muncul di rincian aplikasi
        res.status(201).json({ 
            success: true, 
            message: "Pesanan berhasil dibuat", 
            order_id: newOrderId,
            rincian_pembayaran: {
                subtotal_awal: rincian_biaya.total_akhir,
                potongan_diskon: discountAmount,
                total_bayar: finalTotalPrice,
                voucher_code: voucher_code || null
            }
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("❌ [DEBUG] createOrder Error:", error.stack);
        res.status(500).json({ success: false, message: "Gagal membuat pesanan", error: error.message });
    } finally {
        if (connection) connection.release();
    }
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
                o.address_customer AS address_customer, 
                m.full_name AS mitra_name, 
                m.phone_number AS mitra_phone,
                s.store_name,
                -- Menghitung kembali subtotal kotor jika diperlukan di frontend
                (o.total_price + o.discount_amount) as original_subtotal,
                (SELECT rating FROM reviews WHERE order_id = o.id LIMIT 1) as already_rated,
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
            SELECT 
                o.id, 
                o.status, 
                o.total_price, 
                o.discount_amount, -- Menambahkan kolom ini agar list order tahu ada diskon
                o.scheduled_date, 
                o.scheduled_time, 
                o.order_date, 
                o.cancelled_by, 
                s.store_name as mitra_name 
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

exports.cancelOrder = async (req, res) => {
    const { orderId, reason } = req.body;
    try {
        const sql = `
            UPDATE orders 
            SET status = 'cancelled', 
                cancelled_by = 'customer',
                cancel_reason = ? 
            WHERE id = ? AND status IN ('pending', 'unpaid')
        `;
        const [result] = await db.execute(sql, [reason, orderId]);
        
        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Pesanan berhasil dibatalkan' });
        } else {
            res.status(400).json({ success: false, message: 'Pesanan tidak dapat dibatalkan' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getAllOrdersAdmin = async (req, res) => {
    try {
        const sql = `
            SELECT 
                o.id, 
                o.status, 
                o.total_price, 
                o.platform_fee,
                o.service_fee,
                o.scheduled_date, 
                o.scheduled_time, 
                o.order_date, 
                o.cancelled_by,   
                o.cancel_reason,  
                s.store_name as mitra_name,
                u.full_name as customer_name,
                p.payment_method,
                p.payment_type,
                p.payment_status
            FROM orders o
            JOIN stores s ON o.store_id = s.id
            JOIN users u ON o.customer_id = u.id
            LEFT JOIN payments p ON o.id = p.order_id
            ORDER BY o.order_date DESC`;

        const [rows] = await db.execute(sql);
        
        console.log(`✅ Berhasil mengambil ${rows.length} data untuk Admin`);
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error("❌ Get All Orders Admin Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getRefundHistory = async (req, res) => {
    try {
        const sql = `
            SELECT 
                p.order_id, 
                u.full_name as customer_name, 
                p.gross_amount as nominal_refund, 
                p.transaction_time as tanggal_refund,
                o.status as order_status,
                o.platform_fee,
                o.service_fee,
                o.cancelled_by,
                o.cancel_reason
            FROM payments p
            JOIN orders o ON p.order_id = o.id
            JOIN users u ON o.customer_id = u.id
            WHERE p.payment_status = 'refund'
            ORDER BY p.transaction_time DESC
        `;

        const [rows] = await db.execute(sql);

        res.status(200).json({
            success: true,
            message: "Berhasil mengambil riwayat refund",
            data: rows
        });
    } catch (error) {
        console.error("Error Get Refund History:", error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

exports.updateOrderStatus = async (req, res) => {
    const { id } = req.params;
    const { status, notes } = req.body; // Menambah notes jika ada alasan pembatalan
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Ambil data order & info pelanggan
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

        // 2. Validasi status final
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

        // 4. LOGIKA MAPPING STATUS
        let statusToSave = status;
        let cancelledBy = null;
        let responseMessage = `Status berhasil diperbarui ke ${status}`;

        if (status === 'completed') {
            if (!req.file && !proofImageUrl) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: "Bukti foto wajib diunggah untuk menyelesaikan pekerjaan." });
            }
            statusToSave = 'working';
            responseMessage = "Laporan pengerjaan terkirim. Menunggu konfirmasi pelanggan.";
        }
        else if (status === 'cancelled') {
            // Karena ini adalah controller yang diakses Mitra, maka kita set 'mitra'
            cancelledBy = 'mitra';
            responseMessage = "Pesanan berhasil dibatalkan.";
        }

        // 5. Eksekusi Update ke Database (Menambahkan cancelled_by)
        await connection.execute(
            "UPDATE orders SET status = ?, proof_image_url = ?, cancelled_by = ? WHERE id = ?",
            [statusToSave, proofImageUrl, cancelledBy, id]
        );

        // 6. Simpan Log Aktivitas (Diperjelas untuk pembatalan)
        let logNotes = status === 'completed'
            ? `Mitra melaporkan pekerjaan selesai (Menunggu konfirmasi)`
            : `Status diperbarui ke ${status} oleh mitra`;

        if (status === 'cancelled') {
            logNotes = `Dibatalkan oleh mitra. Alasan: ${notes || 'Tidak ada alasan'}`;
        }

        await connection.execute(
            "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, ?, ?)",
            [id, statusToSave, logNotes]
        );

        await connection.commit();

        // 7. RESPON KE CLIENT
        res.status(200).json({
            success: true,
            message: responseMessage,
            data: { orderId: id, status: statusToSave, cancelled_by: cancelledBy }
        });

        // 8. PROSES NOTIFIKASI FCM
        if (customerFcm) {
            const statusMap = {
                'accepted': 'telah diterima oleh teknisi',
                'on_the_way': 'sedang menuju lokasi Anda',
                'working': 'sedang dikerjakan',
                'completed': 'telah selesai dikerjakan dan menunggu konfirmasi Anda ✅',
                'cancelled': 'telah dibatalkan oleh mitra ❌'
            };

            const title = status === 'cancelled' ? "Pesanan Dibatalkan ❌" : "Update Pesanan 🔔";
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