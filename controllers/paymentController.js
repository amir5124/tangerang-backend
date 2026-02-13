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
            jadwal, lokasi, rincian_biaya, layananTerpilih, catatan, kontak
        } = req.body;

        if (!customer_id || !metode_pembayaran) {
            return res.status(400).json({ success: false, message: "Data tidak lengkap" });
        }

        const partner_reff = helpers.generatePartnerReff();
        const isQRIS = metode_pembayaran === 'QRIS';
        const expired = helpers.getExpiredTimestamp(isQRIS ? 30 : 1440);
        const finalEmail = helpers.isValidEmail(kontak?.email) ? kontak.email : process.env.DEFAULT_EMAIL;

        // 2. SIMPAN KE TABEL ORDERS 
        // PERUBAHAN: Status awal diset 'unpaid' agar tidak muncul di aplikasi Mitra
        // 2. SIMPAN KE TABEL ORDERS 
        // PERBAIKAN: Tambahkan lat_customer dan lng_customer di sini
        const sqlOrder = `INSERT INTO orders 
(customer_id, store_id, scheduled_date, scheduled_time, building_type, 
 address_customer, lat_customer, lng_customer, total_price, 
 platform_fee, service_fee, status, customer_notes, items) 
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)`;

        console.log("DEBUG: Executing Order Insert with Coordinates...");
        const [orderResult] = await connection.execute(sqlOrder, [
            customer_id,
            store_id,
            jadwal.tanggal,
            jadwal.waktu,
            jenisGedung,
            lokasi.alamatLengkap,
            lokasi.latitude || null,  // Mapping Latitude
            lokasi.longitude || null, // Mapping Longitude
            rincian_biaya.subtotal_layanan,
            rincian_biaya.biaya_layanan_app,
            rincian_biaya.biaya_transaksi,
            catatan || null,
            JSON.stringify(layananTerpilih)
        ]);

        const newOrderId = orderResult.insertId;

        // 3. SIMPAN KE ORDER ITEMS
        const sqlItem = `INSERT INTO order_items (order_id, service_name, qty, price_satuan, subtotal) VALUES (?, ?, ?, ?, ?)`;
        for (const item of layananTerpilih) {
            await connection.execute(sqlItem, [
                newOrderId, item.nama, item.qty, item.hargaSatuan, (item.qty * item.hargaSatuan)
            ]);
        }

        // 4. REQUEST KE LINKQU
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

        // 5. SIMPAN KE PAYMENTS
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
        console.log("DEBUG: Transaction Committed. Order is currently 'unpaid'.");

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
        console.error("!!! BACKEND CRASH ERROR !!!", err.message);
        res.status(500).json({ success: false, message: "Internal Server Error" });
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

                // 2. PERUBAHAN: Ubah status order ke 'pending' agar muncul di aplikasi Mitra (Modal Terima/Abaikan)
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
        // 1. Cek status di Database Lokal dulu (karena Webhook sering lebih cepat)
        const [rows] = await connection.execute(
            `SELECT p.payment_status, o.id AS order_id FROM payments p 
             JOIN orders o ON p.order_id = o.id 
             WHERE p.transaction_id = ?`,
            [partnerReff]
        );

        // Jika di DB sudah sukses (oleh webhook), langsung kembalikan SUCCESS
        if (rows.length > 0 && (rows[0].payment_status === 'settlement' || rows[0].payment_status === 'SUCCESS')) {
            return res.json({
                success: true,
                status: 'SUCCESS',
                message: "Status updated via Webhook"
            });
        }

        // 2. Jika di DB masih pending, baru tanya ke LinkQu
        const linkquResult = await linkqu.checkStatus(partnerReff);

        // Ambil status secara aman dari berbagai kemungkinan layer objek LinkQu
        const status = linkquResult?.status || linkquResult?.data?.status || linkquResult?.response_desc;

        console.log(`🔍 Polling Status LinkQu [${partnerReff}]:`, status);

        // Jika LinkQu bilang sukses tapi DB belum (kasus polling manual)
        if (status === 'SUCCESS' || status === 'SETTLED') {
            await connection.beginTransaction();
            // ... (Kode update database Anda tetap sama seperti sebelumnya) ...
            // Pastikan lakukan commit jika update berhasil
            await connection.commit();
        }

        res.json({
            success: true,
            status: (status === 'SUCCESS' || status === 'SETTLED') ? 'SUCCESS' : 'PENDING',
            data: linkquResult
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("❌ Polling Error:", err.message);
        res.status(500).json({ success: false, message: err.message });
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