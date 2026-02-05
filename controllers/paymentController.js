const db = require('../config/db');
const linkqu = require('../services/linkquService');
const helpers = require('../utils/helpers');
const { sendInvoiceEmail } = require('../utils/emailService');
const { sendPushNotification } = require('../services/notificationService'); // Tambahkan ini
const moment = require('moment-timezone');

exports.createPayment = async (req, res) => {
    // 1. LOG REQUEST MASUK DARI MOBILE
    console.log("==========================================");
    console.log("DEBUG: Incoming Request to /create");
    console.log("Timestamp:", new Date().toISOString());
    console.log("Body:", JSON.stringify(req.body, null, 2));
    console.log("==========================================");

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const {
            customer_id, store_id, metode_pembayaran, jenisGedung,
            jadwal, lokasi, rincian_biaya, layananTerpilih, catatan, kontak
        } = req.body;

        // Validasi data dasar untuk menghindari error SQL
        if (!customer_id || !metode_pembayaran) {
            console.error("DEBUG ERROR: Missing required fields (customer_id or method)");
            return res.status(400).json({ success: false, message: "Data tidak lengkap" });
        }

        const partner_reff = helpers.generatePartnerReff();
        const isQRIS = metode_pembayaran === 'QRIS';
        const expired = helpers.getExpiredTimestamp(isQRIS ? 30 : 1440);
        const finalEmail = helpers.isValidEmail(kontak?.email) ? kontak.email : process.env.DEFAULT_EMAIL;

        // 2. SIMPAN KE TABEL ORDERS
        const sqlOrder = `INSERT INTO orders 
            (customer_id, store_id, scheduled_date, scheduled_time, building_type, address_customer, total_price, platform_fee, service_fee, status, customer_notes, items) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`;

        console.log("DEBUG: Executing Order Insert...");
        const [orderResult] = await connection.execute(sqlOrder, [
            customer_id, store_id, jadwal.tanggal, jadwal.waktu, jenisGedung,
            lokasi.alamatLengkap, rincian_biaya.subtotal_layanan,
            rincian_biaya.biaya_layanan_app, rincian_biaya.biaya_transaksi,
            catatan || null, JSON.stringify(layananTerpilih)
        ]);

        const newOrderId = orderResult.insertId;
        console.log("DEBUG: Order Created ID:", newOrderId);

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

        console.log("DEBUG: Sending Payload to LinkQu Service:", JSON.stringify(payload, null, 2));

        const linkquRes = isQRIS ? await linkqu.createQRIS(payload) : await linkqu.createVA(payload);

        console.log("DEBUG: LinkQu Response Data:", JSON.stringify(linkquRes.data, null, 2));

        if (!linkquRes.data || linkquRes.data.status !== 'SUCCESS') {
            console.error("DEBUG ERROR: LinkQu Status Not Success", linkquRes.data);
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
        console.log("DEBUG: Transaction Committed Successfully");

        const responseData = {
            success: true,
            order_id: newOrderId,
            payment_data: {
                va_number: linkquRes.data.virtual_account || null,
                qris_url: linkquRes.data.imageqris || null,
                expired_at: formattedExpired,
                amount: rincian_biaya.total_akhir,
                partner_reff: partner_reff // Dibutuhkan frontend untuk polling
            }
        };

        res.json(responseData);

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("!!! BACKEND CRASH ERROR !!!", err.message);
        res.status(500).json({ success: false, message: "Internal Server Error", debug_message: err.message });
    } finally {
        connection.release();
    }
};

// exports.handleCallback = async (req, res) => {
//     const connection = await db.getConnection();
//     try {
//         const { partner_reff, status, amount } = req.body;

//         if (status === 'SUCCESS' || status === 'SETTLED') {
//             await connection.beginTransaction();

//             // Query diperluas untuk mengambil fcm_token Mitra (store_id)
//             const [rows] = await connection.execute(
//                 `SELECT 
//                     o.id AS order_id, o.items, o.building_type, o.scheduled_date, 
//                     o.scheduled_time, o.address_customer, o.customer_notes, o.total_price,
//                     u.full_name AS customer_name, u.email AS customer_email, u.phone_number,
//                     m.fcm_token AS mitra_fcm, m.full_name AS mitra_name
//                  FROM payments p
//                  JOIN orders o ON p.order_id = o.id
//                  JOIN users u ON o.customer_id = u.id
//                  LEFT JOIN users m ON o.store_id = m.id
//                  WHERE p.transaction_id = ? AND p.payment_status = 'pending'`,
//                 [partner_reff]
//             );

//             if (rows.length > 0) {
//                 const order = rows[0];

//                 // Update status transaksi & Order
//                 await connection.execute("UPDATE payments SET payment_status = 'settlement', transaction_time = NOW() WHERE transaction_id = ?", [partner_reff]);
//                 await connection.execute("UPDATE orders SET status = 'accepted' WHERE id = ?", [order.order_id]);
//                 await connection.execute("INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'accepted', 'Pembayaran berhasil dikonfirmasi via LinkQu Callback')", [order.order_id]);

//                 await connection.commit();

//                 // 1. KIRIM NOTIFIKASI KE MITRA
//                 if (order.mitra_fcm) {
//                     await sendPushNotification(
//                         order.mitra_fcm,
//                         "Pesanan Baru Masuk!",
//                         `Halo ${order.mitra_name}, pembayaran Order #${order.order_id} sebesar Rp ${parseInt(amount).toLocaleString('id-ID')} telah diterima.`,
//                         { orderId: String(order.order_id), type: "NEW_ORDER" }
//                     );
//                 }

//                 // 2. KIRIM INVOICE EMAIL
//                 const layananTerpilih = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
//                 const emailPayload = {
//                     orderId: order.order_id,
//                     customer: { nama: order.customer_name, email: order.customer_email, wa: order.phone_number },
//                     layanan: layananTerpilih,
//                     properti: {
//                         jenisGedung: order.building_type,
//                         jadwal: `${moment(order.scheduled_date).format('DD-MM-YYYY')} | ${order.scheduled_time}`,
//                         alamat: order.address_customer,
//                         catatan: order.customer_notes || "-"
//                     },
//                     pembayaran: { total: `Rp${parseInt(amount).toLocaleString('id-ID')}`, metode: "LinkQu Payment", reff: partner_reff }
//                 };

//                 await sendInvoiceEmail(order.customer_email, emailPayload, false);
//                 await sendInvoiceEmail(process.env.DEFAULT_EMAIL, { ...emailPayload, isAdmin: true }, true);

//                 console.log(`✅ Webhook: Order #${order.order_id} processed.`);
//             }
//         }
//         res.status(200).send("OK");
//     } catch (err) {
//         if (connection) await connection.rollback();
//         console.error("❌ Callback Error:", err.message);
//         res.status(500).send("Callback Error");
//     } finally {
//         connection.release();
//     }
//};

exports.handleCallback = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const { partner_reff, status, amount } = req.body;

        // Log awal untuk memantau data yang masuk dari LinkQu
        console.log(`📩 Webhook Received: Reff #${partner_reff} | Status: ${status}`);

        if (status === 'SUCCESS' || status === 'SETTLED') {
            await connection.beginTransaction();

            // Ambil data detail Order, Customer, dan Token FCM Mitra
            const [rows] = await connection.execute(
                `SELECT 
                    o.id AS order_id, o.items, o.building_type, o.scheduled_date, 
                    o.scheduled_time, o.address_customer, o.customer_notes, o.total_price,
                    u.full_name AS customer_name, u.email AS customer_email, u.phone_number,
                    m.fcm_token AS mitra_fcm, m.full_name AS mitra_name
                 FROM payments p
                 JOIN orders o ON p.order_id = o.id
                 JOIN users u ON o.customer_id = u.id
                 /* 1. Sambungkan Order ke Tabel Stores berdasarkan store_id */
                 JOIN stores s ON o.store_id = s.id
                 /* 2. Sambungkan Stores ke Tabel Users untuk ambil data pemilik toko (Mitra) */
                 JOIN users m ON s.user_id = m.id
                 WHERE p.transaction_id = ? AND p.payment_status = 'pending'`,
                [partner_reff]
            );

            if (rows.length > 0) {
                const order = rows[0];

                // 1. Update Database (WAJIB SELESAI DULU)
                await connection.execute(
                    "UPDATE payments SET payment_status = 'settlement', transaction_time = NOW() WHERE transaction_id = ?",
                    [partner_reff]
                );
                await connection.execute(
                    "UPDATE orders SET status = 'accepted' WHERE id = ?",
                    [order.order_id]
                );
                await connection.execute(
                    "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'accepted', 'Pembayaran berhasil dikonfirmasi via LinkQu Callback')",
                    [order.order_id]
                );

                // Commit transaksi DB agar data aman sebelum kirim notif
                await connection.commit();
                console.log(`✅ DB Updated: Order #${order.order_id} has been accepted.`);

                // 2. KIRIM PUSH NOTIFICATION KE MITRA
                if (order.mitra_fcm) {
                    try {
                        await sendPushNotification(
                            order.mitra_fcm,
                            "Pesanan Baru Masuk! 🔔",
                            `Halo ${order.mitra_name}, ada pesanan baru #${order.order_id} sebesar Rp ${parseInt(amount).toLocaleString('id-ID')}.`,
                            { orderId: String(order.order_id), type: "NEW_ORDER" }
                        );
                        console.log(`📲 FCM Sent: Notifikasi terkirim ke Mitra ${order.mitra_name}`);
                    } catch (fcmErr) {
                        console.error("⚠️ FCM Error: Gagal mengirim push notif:", fcmErr.message);
                    }
                } else {
                    console.log("ℹ️ FCM Skip: Mitra tidak memiliki token (NULL).");
                }

                // 3. BAGIAN EMAIL (DIKOMENTARI UNTUK TESTING NOTIF)
                /* const layananTerpilih = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
                const emailPayload = {
                    orderId: order.order_id,
                    customer: { nama: order.customer_name, email: order.customer_email, wa: order.phone_number },
                    layanan: layananTerpilih,
                    properti: {
                        jenisGedung: order.building_type,
                        jadwal: `${moment(order.scheduled_date).format('DD-MM-YYYY')} | ${order.scheduled_time}`,
                        alamat: order.address_customer,
                        catatan: order.customer_notes || "-"
                    },
                    pembayaran: { total: `Rp${parseInt(amount).toLocaleString('id-ID')}`, metode: "LinkQu Payment", reff: partner_reff }
                };

                // Sementara dimatikan karena kendala SMTP Gmail
                // await sendInvoiceEmail(order.customer_email, emailPayload, false);
                // await sendInvoiceEmail(process.env.DEFAULT_EMAIL, { ...emailPayload, isAdmin: true }, true);
                */

                console.log(`🚀 Webhook Processed Successfully for Order #${order.order_id}`);
            } else {
                console.log(`⚠️ Webhook Skip: Transaction ID #${partner_reff} not found or already processed.`);
            }
        }

        // LinkQu membutuhkan respon 200 OK agar tidak mengirim ulang callback
        res.status(200).send("OK");

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("❌ Callback Error:", err.message);
        // Tetap kirim 500 agar LinkQu tahu ada masalah di server kita
        res.status(500).send("Callback Error");
    } finally {
        connection.release();
    }
};

exports.checkPaymentStatus = async (req, res) => {
    const { partnerReff } = req.params;
    const connection = await db.getConnection();

    try {
        // 1. Ambil status terbaru dari LinkQu
        const linkquStatus = await linkqu.checkStatus(partnerReff);
        console.log(`🔍 Polling Status LinkQu [${partnerReff}]:`, linkquStatus.status);

        if (linkquStatus.status === 'SUCCESS' || linkquStatus.status === 'SETTLED') {
            await connection.beginTransaction();

            // 2. Query diperbaiki dengan JOIN bertingkat (Orders -> Stores -> Users)
            const [rows] = await connection.execute(
                `SELECT 
                    p.payment_status, 
                    o.id AS order_id, 
                    o.total_price,
                    m.fcm_token AS mitra_fcm, 
                    m.full_name AS mitra_name
                 FROM payments p
                 JOIN orders o ON p.order_id = o.id
                 JOIN stores s ON o.store_id = s.id
                 JOIN users m ON s.user_id = m.id
                 WHERE p.transaction_id = ?`,
                [partnerReff]
            );

            if (rows.length > 0) {
                const data = rows[0];

                // Cek apakah di database kita masih 'pending'
                if (data.payment_status === 'pending') {
                    // 3. Update Status ke Settlement
                    await connection.execute(
                        "UPDATE payments SET payment_status = 'settlement', transaction_time = NOW() WHERE transaction_id = ?",
                        [partnerReff]
                    );
                    await connection.execute(
                        "UPDATE orders SET status = 'accepted' WHERE id = ?",
                        [data.order_id]
                    );
                    await connection.execute(
                        "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'accepted', 'Pembayaran berhasil dikonfirmasi via manual polling')",
                        [data.order_id]
                    );

                    await connection.commit();
                    console.log(`✅ Polling DB Updated: Order #${data.order_id} processed.`);

                    // 4. KIRIM NOTIFIKASI KE MITRA
                    if (data.mitra_fcm) {
                        try {
                            await sendPushNotification(
                                data.mitra_fcm,
                                "💰 Pesanan Baru Masuk!",
                                `Halo ${data.mitra_name}, Order #${data.order_id} senilai Rp ${Number(data.total_price).toLocaleString('id-ID')} telah dibayar.`,
                                { orderId: String(data.order_id), type: "NEW_ORDER" }
                            );
                        } catch (fcmErr) {
                            console.error("⚠️ FCM Polling Error:", fcmErr.message);
                        }
                    }
                } else {
                    console.log(`ℹ️ Polling Skip: Order #${data.order_id} sudah berstatus ${data.payment_status}.`);
                }
            }
        }

        // Kembalikan response ke frontend agar loader berhenti
        res.json({
            success: true,
            status: linkquStatus.status, // Kirim status asli (SUCCESS/SETTLED)
            data: linkquStatus
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("❌ Polling Error:", err.message);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        connection.release();
    }
};