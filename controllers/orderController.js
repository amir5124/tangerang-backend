const fs = require('fs');
const db = require('../config/db');

// ✅ Tambah import sendToUser & sendToRole
const { sendToUser, sendToRole } = require('../services/notificationService');

const parseCommission = (raw) => {
    const parsed = parseFloat(raw);
    if (isNaN(parsed) || parsed < 0 || parsed > 100) return 70;
    return parseFloat(parsed.toFixed(2));
};

// ✅ notifyAdmins sekarang pakai sendToRole — tidak query users 
const notifyAdmins = async (title, body, orderId = null) => {
    try {
        const dataPayload = {
            type: "ADMIN_ORDER_ALERT",
            ...(orderId && { orderId: String(orderId) }),
        };
        await sendToRole('admin', title, body, dataPayload);
    } catch (error) {
        console.error(`[DEBUG] [ADMIN-NOTIF] Error:`, error.message);
    }
};

const releaseFundsToMitra = async (connection, orderId) => {
    console.log(`[DEBUG] === Memulai Proses Pencairan Dana Order #${orderId} ===`);

    const [existingTx] = await connection.execute(
        "SELECT id FROM wallet_transactions WHERE description LIKE ?",
        [`%Order #${orderId}%`]
    );

    if (existingTx.length > 0) {
        console.warn(`[DEBUG] [PREVENT] Order #${orderId} sudah pernah dicairkan sebelumnya.`);
        return false;
    }

    const [order] = await connection.execute(
        `SELECT 
            o.total_price, 
            o.discount_amount, 
            o.platform_fee, 
            o.service_fee, 
            s.user_id   AS mitra_user_id,
            s.store_name,
            IFNULL(s.commission_rate, 70) AS commission_rate
         FROM orders o 
         JOIN stores s ON o.store_id = s.id 
         WHERE o.id = ?`,
        [orderId]
    );

    if (order.length === 0) {
        console.error(`[DEBUG] [ERROR] Order #${orderId} tidak ditemukan.`);
        return false;
    }

    const { total_price, discount_amount, mitra_user_id, store_name, commission_rate } = order[0];

    const paidByCustomer = parseFloat(total_price) || 0;
    const discountVal = parseFloat(discount_amount) || 0;
    const commissionPct = parseCommission(commission_rate);
    const grossOriginal = paidByCustomer + discountVal;
    const netAmount = Math.floor(grossOriginal * (commissionPct / 100));
    const appProfitBersih = paidByCustomer - netAmount;
    const appProfitKotor = grossOriginal - netAmount;
    const appPct = parseFloat((100 - commissionPct).toFixed(2));

    console.log(`[DEBUG] Rincian Dana Order #${orderId}:
    - Toko                  : ${store_name}
    - Nilai Jasa Asli       : Rp${grossOriginal.toLocaleString('id-ID')} (dasar bagi hasil)
    - Voucher (beban app)   : Rp${discountVal.toLocaleString('id-ID')}
    - Customer Bayar        : Rp${paidByCustomer.toLocaleString('id-ID')}
    --------------------------------------------------
    - Komisi Mitra          : ${commissionPct}%
    - Net to Mitra          : Rp${netAmount.toLocaleString('id-ID')}
    - Profit App ${appPct}% (kotor)  : Rp${appProfitKotor.toLocaleString('id-ID')}
    - Voucher ditanggung app: Rp${discountVal.toLocaleString('id-ID')}
    - Profit App (bersih)   : Rp${appProfitBersih.toLocaleString('id-ID')}
    --------------------------------------------------`);

    const [walletCheck] = await connection.execute(
        "SELECT id FROM wallets WHERE user_id = ?", [mitra_user_id]
    );

    let walletId;
    if (walletCheck.length === 0) {
        console.log(`[DEBUG] Pembuatan wallet baru untuk Mitra UID: ${mitra_user_id}`);
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

    await connection.execute(
        "INSERT INTO wallet_transactions (wallet_id, amount, type, description) VALUES (?, ?, 'credit', ?)",
        [
            walletId,
            netAmount,
            `Penghasilan Order #${orderId} (${commissionPct}% dari nilai jasa Rp${grossOriginal.toLocaleString('id-ID')})`
        ]
    );

    notifyAdmins(
        "Pencairan Dana 💸",
        `Dana Order #${orderId} sebesar Rp${netAmount.toLocaleString('id-ID')} (${commissionPct}%) telah masuk ke dompet ${store_name}.`,
        orderId
    );

    console.log(`[DEBUG] === Pencairan Dana Selesai Order #${orderId}. Mitra menerima: Rp${netAmount.toLocaleString('id-ID')} ===`);
    return { netAmount, mitra_user_id }; // ✅ return mitra_user_id juga untuk keperluan notif
};

// ============================================================
// createOrder — tidak ada perubahan logika, hanya notifyAdmins sudah pakai sendToRole
// ============================================================
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
            const [vouchers] = await connection.execute(
                "SELECT * FROM vouchers WHERE code = ? AND is_active = 1 AND (expired_at > NOW() OR expired_at IS NULL)",
                [voucher_code]
            );

            if (vouchers.length > 0) {
                const v = vouchers[0];
                const [usageResult] = await connection.execute(
                    "SELECT COUNT(*) as total_usage FROM voucher_usages WHERE voucher_id = ? AND user_id = ?",
                    [v.id, customer_id]
                );
                const currentUsage = usageResult[0].total_usage;
                const limit = v.usage_limit || 1;

                if (currentUsage < limit) {
                    appliedVoucherId = v.id;
                    discountAmount = Math.floor(rincian_biaya.subtotal_layanan * (v.discount_percent / 100));
                    if (v.max_discount_amount && discountAmount > v.max_discount_amount) {
                        discountAmount = parseFloat(v.max_discount_amount);
                    }
                }
            }
        }

        const finalTotalPrice = rincian_biaya.total_akhir - discountAmount;

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

        if (appliedVoucherId) {
            await connection.execute(
                "INSERT INTO voucher_usages (voucher_id, user_id, order_id) VALUES (?, ?, ?)",
                [appliedVoucherId, customer_id, newOrderId]
            );
        }

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

        notifyAdmins("Pesanan Baru 🛒", `Order #${newOrderId} telah dibuat. Status: UNPAID. Total: Rp${finalTotalPrice.toLocaleString()}`, newOrderId);

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

// ============================================================
// getOrderDetail — tidak ada perubahan
// ============================================================
exports.getOrderDetail = async (req, res) => {
    const { id } = req.params;
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
                IFNULL(s.commission_rate, 70) AS commission_rate,
                (o.total_price + o.discount_amount) as original_subtotal,
                FLOOR((o.total_price + o.discount_amount) * (IFNULL(s.commission_rate, 70) / 100)) AS projected_mitra_earning,
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
            return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan' });
        }

        let data = rows[0];
        data.commission_rate = parseCommission(data.commission_rate);

        if (data.proof_image_url && !data.proof_image_url.startsWith('http')) {
            data.proof_image_url = `${req.protocol}://${req.get('host')}/${data.proof_image_url.replace(/\\/g, '/')}`;
        }

        res.status(200).json({ success: true, data: data });
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
    }
};

// ============================================================
// getUserOrders — tidak ada perubahan
// ============================================================
exports.getUserOrders = async (req, res) => {
    try {
        const { userId } = req.params;
        const sql = `
            SELECT 
                o.id, o.status, o.total_price, o.discount_amount, 
                o.scheduled_date, o.scheduled_time, o.order_date, o.cancelled_by, 
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

// ============================================================
// cancelOrder — tidak ada perubahan
// ============================================================
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
            notifyAdmins("Pesanan Dibatalkan ⚠️", `Order #${orderId} dibatalkan Pelanggan. Alasan: ${reason || '-'}`, orderId);
            res.json({ success: true, message: 'Pesanan berhasil dibatalkan' });
        } else {
            res.status(400).json({ success: false, message: 'Pesanan tidak dapat dibatalkan' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ============================================================
// getAllOrdersAdmin — tidak ada perubahan
// ============================================================
exports.getAllOrdersAdmin = async (req, res) => {
    try {
        const sql = `
            SELECT 
                o.id, o.status, o.customer_notes, o.total_price, 
                o.platform_fee, o.service_fee, o.scheduled_date, o.scheduled_time, 
                o.order_date, o.cancelled_by, o.cancel_reason, 
                s.store_name as mitra_name, 
                IFNULL(s.commission_rate, 70) AS commission_rate,
                FLOOR((o.total_price + IFNULL(o.discount_amount, 0)) * (IFNULL(s.commission_rate, 70) / 100)) AS mitra_earning,
                ((o.total_price + IFNULL(o.discount_amount, 0)) - FLOOR((o.total_price + IFNULL(o.discount_amount, 0)) * (IFNULL(s.commission_rate, 70) / 100))) AS app_profit,
                u.full_name as customer_name, 
                p.payment_method, p.payment_type, p.payment_status
            FROM orders o
            JOIN stores s ON o.store_id = s.id
            JOIN users u ON o.customer_id = u.id
            LEFT JOIN payments p ON o.id = p.order_id
            ORDER BY o.order_date DESC`;
        const [rows] = await db.execute(sql);

        const normalized = rows.map(r => ({
            ...r,
            commission_rate: parseCommission(r.commission_rate)
        }));

        res.status(200).json({ success: true, data: normalized });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ============================================================
// getRefundHistory — tidak ada perubahan
// ============================================================
exports.getRefundHistory = async (req, res) => {
    try {
        const sql = `
            SELECT 
                p.order_id, u.full_name as customer_name, p.gross_amount as nominal_refund, 
                p.transaction_time as tanggal_refund, o.status as order_status, 
                o.platform_fee, o.service_fee, o.cancelled_by, o.cancel_reason
            FROM payments p
            JOIN orders o ON p.order_id = o.id
            JOIN users u ON o.customer_id = u.id
            WHERE p.payment_status = 'refund'
            ORDER BY p.transaction_time DESC`;
        const [rows] = await db.execute(sql);
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// ============================================================
// updateOrderStatus — ✅ notif customer pakai sendToUser
// ============================================================
exports.updateOrderStatus = async (req, res) => {
    const { id } = req.params;
    const { status, notes } = req.body;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // ✅ Tidak perlu ambil fcm_token dari users, cukup ambil customer_id & nama
        const [orderData] = await connection.execute(
            `SELECT o.status, o.proof_image_url, o.customer_id, u.full_name 
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
        const customerId = orderData[0].customer_id;   // ✅ pakai ID, bukan token
        const customerName = orderData[0].full_name;

        if (['completed', 'cancelled'].includes(currentStatus)) {
            if (req.file) fs.unlinkSync(req.file.path);
            await connection.rollback();
            return res.status(400).json({ success: false, message: "Pesanan sudah bersifat final." });
        }

        let proofImageUrl = orderData[0].proof_image_url;
        if (req.file) {
            proofImageUrl = req.file.path.replace(/\\/g, '/');
        }

        let statusToSave = status;
        let cancelledBy = null;
        let responseMessage = `Status berhasil diperbarui ke ${status}`;

        if (status === 'completed') {
            if (!req.file && !proofImageUrl) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: "Bukti foto wajib diunggah." });
            }
            statusToSave = 'working';
            responseMessage = "Laporan pengerjaan terkirim. Menunggu konfirmasi pelanggan.";
        } else if (status === 'cancelled') {
            cancelledBy = 'mitra';
            responseMessage = "Pesanan berhasil dibatalkan.";
        }

        await connection.execute(
            "UPDATE orders SET status = ?, proof_image_url = ?, cancelled_by = ? WHERE id = ?",
            [statusToSave, proofImageUrl, cancelledBy, id]
        );

        let logNotes = status === 'completed' ? `Mitra melaporkan pekerjaan selesai` : `Status diperbarui ke ${status} oleh mitra`;
        if (status === 'cancelled') logNotes = `Dibatalkan oleh mitra. Alasan: ${notes || 'Tidak ada alasan'}`;

        await connection.execute(
            "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, ?, ?)",
            [id, statusToSave, logNotes]
        );

        await connection.commit();

        notifyAdmins("Update Status Order 🛠️", `Order #${id} diupdate ke ${statusToSave} oleh Mitra.`, id);

        res.status(200).json({
            success: true,
            message: responseMessage,
            data: { orderId: id, status: statusToSave, cancelled_by: cancelledBy }
        });

        // ✅ Kirim notif ke customer via sendToUser (dari user_devices)
        const statusMap = {
            'accepted': 'telah diterima oleh teknisi',
            'on_the_way': 'sedang menuju lokasi Anda',
            'working': 'sedang dikerjakan',
            'completed': 'telah selesai dikerjakan dan menunggu konfirmasi Anda ✅',
            'cancelled': 'telah dibatalkan oleh mitra ❌'
        };
        const title = status === 'cancelled' ? "Pesanan Dibatalkan ❌" : "Update Pesanan 🔔";
        const body = `Halo ${customerName}, pesanan Anda ${statusMap[status] || status}`;
        sendToUser(customerId, title, body, {
            orderId: String(id),
            type: "ORDER_STATUS_UPDATE",
            status: String(statusToSave)
        }).catch(e => { });

    } catch (error) {
        if (connection) await connection.rollback();
        if (req.file) fs.unlinkSync(req.file.path);
        if (!res.headersSent) res.status(500).json({ success: false, message: "Server error.", error: error.message });
    } finally {
        connection.release();
    }
};

// ============================================================
// customerCompleteOrder — ✅ notif mitra pakai sendToUser via mitra_user_id
// ============================================================
exports.customerCompleteOrder = async (req, res) => {
    const { id } = req.params;
    const { rating, comment, quality, punctuality, communication } = req.body;
    const connection = await db.getConnection();

    console.log(`\n[DEBUG] === Memulai Proses Konfirmasi Order #${id} ===`);

    try {
        await connection.beginTransaction();

        const [orderData] = await connection.execute("SELECT customer_id, store_id, status FROM orders WHERE id = ?", [id]);
        if (orderData.length === 0) throw new Error("Order tidak ditemukan");

        const { customer_id, store_id, status: currentStatus } = orderData[0];

        await connection.execute(
            `INSERT INTO reviews (order_id, customer_id, store_id, rating, rating_quality, rating_punctuality, rating_communication, comment) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment)`,
            [id, customer_id, store_id, parseInt(rating) || 5, parseInt(quality) || 5, parseInt(punctuality) || 5, parseInt(communication) || 5, comment || ""]
        );

        const [updateResult] = await connection.execute(
            "UPDATE orders SET status = 'completed' WHERE id = ? AND status != 'completed'",
            [id]
        );

        await connection.execute(
            `UPDATE stores SET 
                average_rating = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE store_id = ?), 
                total_reviews = (SELECT COUNT(*) FROM reviews WHERE store_id = ?) 
             WHERE id = ?`,
            [store_id, store_id, store_id]
        );

        if (updateResult.affectedRows > 0) {
            const result = await releaseFundsToMitra(connection, id);

            notifyAdmins("Order Selesai ✅", `Pelanggan telah mengkonfirmasi penyelesaian Order #${id}. Rating: ${rating}⭐`, id);

            // ✅ Kirim notif ke mitra via sendToUser (dari user_devices, bukan fcm_token langsung)
            if (result && result.netAmount) {
                const formatted = new Intl.NumberFormat('id-ID', {
                    style: 'currency',
                    currency: 'IDR',
                    maximumFractionDigits: 0
                }).format(result.netAmount);

                sendToUser(
                    result.mitra_user_id,
                    "Dana Masuk! 💰",
                    `Selamat! Pendapatan ${formatted} dari Order #${id} masuk ke dompet.`,
                    { type: 'WALLET_UPDATE', orderId: String(id) }
                ).catch(e => { });
            }
        }

        await connection.commit();
        res.status(200).json({
            success: true,
            message: updateResult.affectedRows > 0 ? "Pesanan selesai & dana dicairkan." : "Ulasan diperbarui."
        });

    } catch (error) {
        if (connection) await connection.rollback();
        res.status(500).json({ success: false, message: "Gagal memproses", error: error.message });
    } finally {
        if (connection) connection.release();
    }
};

exports.internalReleaseFunds = releaseFundsToMitra;