const db = require('../config/db');
const linkqu = require('../services/linkquService');
const helpers = require('../utils/helpers');
const { sendInvoiceEmail } = require('../utils/emailService');
const { sendPushNotification } = require('../services/notificationService'); // Tambahkan ini
const moment = require('moment-timezone');

exports.createPayment = async (req, res) => {
    console.log("==========================================");
    console.log("DEBUG: Incoming Request to /create");
    console.log("Timestamp:", new Date().toISOString());
    console.log("==========================================");

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const {
            customer_id, store_id, metode_pembayaran, jenisGedung,
            jadwal, lokasi, rincian_biaya, layananTerpilih, catatan, kontak,
            voucher_code // Tangkap kode voucher dari frontend
        } = req.body;

        if (!customer_id || !metode_pembayaran) {
            return res.status(400).json({ success: false, message: "Data tidak lengkap" });
        }

        const partner_reff = helpers.generatePartnerReff();
        const isQRIS = metode_pembayaran === 'QRIS';
        const expired = helpers.getExpiredTimestamp(isQRIS ? 30 : 1440);
        const finalEmail = helpers.isValidEmail(kontak?.email) ? kontak.email : process.env.DEFAULT_EMAIL;

        // 1. VALIDASI DISKON
        // Pastikan nilai diskon diambil dari rincian_biaya yang dikirim frontend
        const discountVal = parseFloat(rincian_biaya.diskon_voucher) || 0;

        // 2. SIMPAN KE TABEL ORDERS 
        // Tambahkan kolom discount_amount di sini agar tidak 0.00
        const sqlOrder = `INSERT INTO orders 
            (customer_id, store_id, scheduled_date, scheduled_time, building_type, 
             address_customer, lat_customer, lng_customer, total_price, 
             discount_amount, platform_fee, service_fee, status, customer_notes, items) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)`;

        console.log(`DEBUG: Inserting Order with Discount: Rp${discountVal}`);

        const [orderResult] = await connection.execute(sqlOrder, [
            customer_id,
            store_id,
            jadwal.tanggal,
            jadwal.waktu,
            jenisGedung,
            lokasi.alamatLengkap,
            lokasi.latitude || null,
            lokasi.longitude || null,
            rincian_biaya.subtotal_layanan, // Ini harga dasar sebelum diskon & fee
            discountVal,                    // <--- SEKARANG DISKON TERSIMPAN
            rincian_biaya.biaya_layanan_app,
            rincian_biaya.biaya_transaksi,
            catatan || null,
            JSON.stringify(layananTerpilih)
        ]);

        const newOrderId = orderResult.insertId;

        // 3. LOGIKA VOUCHER (SESUAI STRUKTUR TABEL)
        if (voucher_code && discountVal > 0) {
            try {
                console.log(`DEBUG: Mencari Voucher ID untuk kode: ${voucher_code}`);
                const [vouchers] = await connection.execute(
                    "SELECT id FROM vouchers WHERE code = ?",
                    [voucher_code]
                );

                if (vouchers.length > 0) {
                    const voucherId = vouchers[0].id;
                    console.log(`DEBUG: Mencatat penggunaan voucher ID ${voucherId} ke voucher_usages`);

                    // HANYA masukkan kolom yang ada di DESCRIBE: voucher_id, user_id, order_id
                    await connection.execute(
                        "INSERT INTO voucher_usages (voucher_id, user_id, order_id) VALUES (?, ?, ?)",
                        [voucherId, customer_id, newOrderId]
                    );
                } else {
                    console.warn(`[WARN] Kode voucher ${voucher_code} tidak ditemukan di database.`);
                }
            } catch (vErr) {
                // Kita gunakan console.error tapi tidak menghentikan transaksi utama
                console.error("!!! ERROR VOUCHER USAGES !!!", vErr.message);
            }
        }

        // 4. SIMPAN KE ORDER ITEMS
        const sqlItem = `INSERT INTO order_items (order_id, service_name, qty, price_satuan, subtotal) VALUES (?, ?, ?, ?, ?)`;
        for (const item of layananTerpilih) {
            await connection.execute(sqlItem, [
                newOrderId, item.nama, item.qty, item.hargaSatuan, (item.qty * item.hargaSatuan)
            ]);
        }

        // 5. REQUEST KE LINKQU (Gunakan total_akhir yang sudah dipotong diskon)
        const payload = {
            amount: rincian_biaya.total_akhir,
            partner_reff: partner_reff,
            expired: expired,
            method: metode_pembayaran,
            nama: kontak.nama,
            email: finalEmail,
            customer_id: customer_id,
            wa: kontak.nomorWhatsApp
        };

        const linkquRes = isQRIS ? await linkqu.createQRIS(payload) : await linkqu.createVA(payload);

        if (!linkquRes.data || linkquRes.data.status !== 'SUCCESS') {
            throw new Error(linkquRes.data?.message || "Gagal mendapatkan respon dari LinkQu");
        }

        // 6. SIMPAN KE PAYMENTS
        const sqlPayment = `INSERT INTO payments 
            (order_id, customer_id, payment_method, transaction_id, gross_amount, payment_status, payment_type, expired_at, payment_details) 
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`;

        const formattedExpired = moment.tz(expired, 'YYYYMMDDHHmmss', 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');

        await connection.execute(sqlPayment, [
            newOrderId, customer_id, metode_pembayaran, partner_reff,
            rincian_biaya.total_akhir, isQRIS ? 'QRIS' : 'VA',
            formattedExpired, JSON.stringify(linkquRes.data)
        ]);

        await connection.commit();
        console.log("DEBUG: Transaction Committed with Discount applied.");

        res.json({
            success: true,
            order_id: newOrderId,
            payment_data: {
                va_number: linkquRes.data.virtual_account || null,
                qris_url: linkquRes.data.imageqris || null,
                expired_at: formattedExpired,
                amount: rincian_biaya.total_akhir,
                partner_reff: partner_reff
            }
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("!!! BACKEND ERROR !!!", err.message);
        res.status(500).json({ success: false, message: err.message || "Internal Server Error" });
    } finally {
        connection.release();
    }
};

exports.handleCallback = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const { partner_reff, status, amount } = req.body;
        console.log(`📩 Webhook Received: Reff #${partner_reff} | Status: ${status}`);

        if (status === 'SUCCESS' || status === 'SETTLED') {
            await connection.beginTransaction();

            const [rows] = await connection.execute(
                `SELECT 
                    o.id AS order_id, o.items, o.building_type, o.scheduled_date, 
                    o.scheduled_time, o.address_customer, o.customer_notes, o.total_price,
                    u.full_name AS customer_name, u.email AS customer_email, u.phone_number,
                    u.fcm_token AS customer_fcm, 
                    m.fcm_token AS mitra_fcm, m.full_name AS mitra_name
                 FROM payments p
                 JOIN orders o ON p.order_id = o.id
                 JOIN users u ON o.customer_id = u.id
                 JOIN stores s ON o.store_id = s.id
                 JOIN users m ON s.user_id = m.id
                 WHERE p.transaction_id = ? AND p.payment_status = 'pending'`,
                [partner_reff]
            );

            if (rows.length > 0) {
                const order = rows[0];

                // 1. Update Payment Status
                await connection.execute(
                    "UPDATE payments SET payment_status = 'settlement', transaction_time = NOW() WHERE transaction_id = ?",
                    [partner_reff]
                );

                // 2. PERUBAHAN: Ubah status order ke 'pending' agar muncul di aplikasi Mitra
                await connection.execute(
                    "UPDATE orders SET status = 'pending' WHERE id = ?",
                    [order.order_id]
                );

                await connection.execute(
                    "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'pending', 'Pembayaran sukses, pesanan diteruskan ke mitra')",
                    [order.order_id]
                );

                await connection.commit();
                console.log(`✅ Order #${order.order_id} is now LIVE for Mitra.`);

                const itemsDetail = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;

                // 3. Notifikasi ke Mitra
                if (order.mitra_fcm) {
                    try {
                        let teksLayanan = "Jasa";
                        if (itemsDetail && itemsDetail.length > 0) {
                            teksLayanan = itemsDetail[0].nama + (itemsDetail.length > 1 ? ` dan ${itemsDetail.length - 1} lainnya` : "");
                        }

                        await sendPushNotification(
                            order.mitra_fcm,
                            "Pesanan Baru Masuk! 🔔",
                            `Halo ${order.mitra_name}, ada pesanan jasa ${teksLayanan} masuk.`,
                            {
                                orderId: String(order.order_id),
                                type: "NEW_ORDER",
                                status: "pending"
                            }
                        );
                    } catch (fcmErr) {
                        console.error("⚠️ FCM Mitra Error:", fcmErr.message);
                    }
                }

                // 4. Notifikasi ke Customer
                if (order.customer_fcm) {
                    try {
                        await sendPushNotification(
                            order.customer_fcm,
                            "Pembayaran Berhasil! ✅",
                            `Halo ${order.customer_name}, pembayaran sukses. Menunggu konfirmasi dari teknisi.`,
                            {
                                orderId: String(order.order_id),
                                type: "PAYMENT_SUCCESS",
                                status: "pending"
                            }
                        );
                    } catch (fcmErr) {
                        console.error("⚠️ FCM Customer Error:", fcmErr.message);
                    }
                }

                // 5. TAMBAHAN: Notifikasi ke Admin (Role Admin)
                try {
                    const [admins] = await connection.execute(
                        "SELECT fcm_token FROM users WHERE role = 'admin' AND fcm_token IS NOT NULL"
                    );

                    if (admins.length > 0) {
                        for (const admin of admins) {
                            await sendPushNotification(
                                admin.fcm_token,
                                "Ada Orderan Baru!",
                                `Order #${order.order_id} sebesar Rp ${parseInt(order.total_price).toLocaleString("id-ID")} telah dibayar oleh ${order.customer_name}.`,
                                {
                                    orderId: String(order.order_id),
                                    type: "ADMIN_NEW_ORDER",
                                    status: "pending"
                                }
                            );
                        }
                        console.log(`📢 Admin Notification sent to ${admins.length} admins.`);
                    }
                } catch (adminFcmErr) {
                    console.error("⚠️ FCM Admin Error:", adminFcmErr.message);
                }
            }
        }
        res.status(200).send("OK");
    } catch (err) {
        if (connection) await connection.rollback();
        console.error("❌ Callback Error:", err.message);
        res.status(500).send("Callback Error");
    } finally {
        connection.release();
    }
};

exports.checkPaymentStatus = async (req, res) => {
    const { partnerReff } = req.params;
    const connection = await db.getConnection();

    try {
        const [rows] = await connection.execute(
            `SELECT p.payment_status, p.expired_at, o.id AS order_id 
             FROM payments p 
             JOIN orders o ON p.order_id = o.id 
             WHERE p.transaction_id = ?`,
            [partnerReff]
        );

        if (rows.length === 0) {
            console.error(`[CHECK_PAYMENT] Not Found: ${partnerReff}`);
            return res.status(404).json({ success: false, message: "Transaksi tidak ditemukan" });
        }

        const { payment_status, expired_at, order_id } = rows[0];

        if (payment_status === 'settlement' || payment_status === 'SUCCESS') {
            return res.json({ success: true, status: 'SUCCESS' });
        }

        if (payment_status === 'pending' && new Date() > new Date(expired_at)) {
            console.log(`[CHECK_PAYMENT] Auto-Expired: ${partnerReff}`);
            await connection.beginTransaction();
            await connection.execute("UPDATE payments SET payment_status = 'expire' WHERE transaction_id = ?", [partnerReff]);
            await connection.execute("UPDATE orders SET status = 'cancelled' WHERE id = ?", [order_id]);
            await connection.execute("INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'cancelled', 'Expired otomatis saat pengecekan status')", [order_id]);
            await connection.commit();
            return res.json({ success: true, status: 'EXPIRED' });
        }

        const linkquResult = await linkqu.checkStatus(partnerReff);
        const status = linkquResult?.status || linkquResult?.data?.status || linkquResult?.response_desc;

        console.log(`[CHECK_PAYMENT] LinkQu Status [${partnerReff}]: ${status}`);

        if (status === 'SUCCESS' || status === 'SETTLED') {
            await connection.beginTransaction();
            await connection.execute("UPDATE payments SET payment_status = 'settlement', transaction_time = NOW() WHERE transaction_id = ?", [partnerReff]);
            await connection.execute("UPDATE orders SET status = 'pending' WHERE id = ?", [order_id]);
            await connection.execute("INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'pending', 'Pembayaran sukses terverifikasi')", [order_id]);
            await connection.commit();

            return res.json({ success: true, status: 'SUCCESS' });
        }

        res.json({
            success: true,
            status: payment_status.toUpperCase(),
            data: linkquResult
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error(`[CHECK_PAYMENT] Error [${partnerReff}]:`, err.message);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    } finally {
        connection.release();
    }
};

exports.getPaymentHistory = async (req, res) => {
    const { customer_id } = req.params;
    const connection = await db.getConnection();

    try {
        // Di dalam paymentController.js (fungsi getPaymentHistory)
        const sql = `
SELECT 
    o.id AS order_id,
    o.scheduled_date,
    o.scheduled_time,
    o.status AS order_status,
    o.total_price,
    s.store_name AS mitra_name, -- GANTI s.name MENJADI s.store_name
    p.payment_method,
    p.payment_status,
    p.pdf_url,
    p.payment_details,
    p.expired_at
FROM orders o
LEFT JOIN payments p ON o.id = p.order_id
LEFT JOIN stores s ON o.store_id = s.id
WHERE o.customer_id = ?
ORDER BY o.id DESC
`;

        const [rows] = await connection.execute(sql, [customer_id]);

        // Parsing payment_details dari JSON string ke Object
        const formattedData = rows.map(row => ({
            ...row,
            payment_details: typeof row.payment_details === 'string' ? JSON.parse(row.payment_details) : row.payment_details
        }));

        res.json({ success: true, data: formattedData });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        connection.release();
    }
};