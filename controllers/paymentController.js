const db = require('../config/db');
const linkqu = require('../services/linkquService');
const helpers = require('../utils/helpers');
const { sendInvoiceEmail } = require('../utils/emailService');
const moment = require('moment-timezone'); // Gunakan timezone

exports.createPayment = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const {
            customer_id, store_id, metode_pembayaran, jenisGedung,
            jadwal, lokasi, rincian_biaya, layananTerpilih, catatan, kontak
        } = req.body;

        const partner_reff = helpers.generatePartnerReff();
        const isQRIS = metode_pembayaran === 'QRIS';
        const expired = helpers.getExpiredTimestamp(isQRIS ? 30 : 1440);
        const finalEmail = helpers.isValidEmail(kontak.email) ? kontak.email : process.env.DEFAULT_EMAIL;

        // 1. Simpan ke tabel 'orders'
        const sqlOrder = `INSERT INTO orders 
            (customer_id, store_id, scheduled_date, scheduled_time, building_type, address_customer, total_price, platform_fee, service_fee, status, customer_notes, items) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`;

        const [orderResult] = await connection.execute(sqlOrder, [
            customer_id, store_id, jadwal.tanggal, jadwal.waktu, jenisGedung,
            lokasi.alamatLengkap, rincian_biaya.subtotal_layanan,
            rincian_biaya.biaya_layanan_app, rincian_biaya.biaya_transaksi,
            catatan || null, JSON.stringify(layananTerpilih)
        ]);

        const newOrderId = orderResult.insertId;

        // 2. Simpan ke tabel 'order_items' (Penting agar data terperinci tersimpan)
        const sqlItem = `INSERT INTO order_items (order_id, service_name, qty, price_satuan, subtotal) VALUES (?, ?, ?, ?, ?)`;
        for (const item of layananTerpilih) {
            await connection.execute(sqlItem, [
                newOrderId, item.nama, item.qty, item.hargaSatuan, (item.qty * item.hargaSatuan)
            ]);
        }

        // 3. Request ke LinkQu Service
        const payload = {
            amount: rincian_biaya.total_akhir,
            partner_reff: partner_reff,
            expired: expired,
            method: metode_pembayaran,
            nama: kontak.nama,
            email: finalEmail,
            customer_id: customer_id,
            customer_name: kontak.nama,
            customer_email: finalEmail,
            url_callback: process.env.CALLBACK_URL
        };

        const linkquRes = isQRIS ? await linkqu.createQRIS(payload) : await linkqu.createVA(payload);

        if (!linkquRes.data || linkquRes.data.status !== 'SUCCESS') {
            throw new Error(linkquRes.data.message || "Gagal mendapatkan respon dari LinkQu");
        }

        // 4. Simpan ke tabel 'payments'
        const sqlPayment = `INSERT INTO payments 
            (order_id, customer_id, payment_method, transaction_id, amount, payment_status, payment_details, expired_at) 
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`;

        const formattedExpired = moment.tz(expired, 'YYYYMMDDHHmmss', 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');

        await connection.execute(sqlPayment, [
            newOrderId, customer_id, metode_pembayaran, partner_reff,
            rincian_biaya.total_akhir, JSON.stringify(linkquRes.data), formattedExpired
        ]);

        await connection.commit();
        res.json({
            success: true,
            order_id: newOrderId,
            payment_data: {
                va_number: linkquRes.data.virtual_account || null,
                qris_url: linkquRes.data.imageqris || null,
                expired_at: formattedExpired,
                amount: rincian_biaya.total_akhir
            }
        });

    } catch (err) {
        if (connection) await connection.rollback();
        res.status(500).json({ success: false, message: err.message });
    } finally {
        connection.release();
    }
};

exports.handleCallback = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const { partner_reff, status, amount } = req.body;

        if (status === 'SUCCESS' || status === 'SETTLED') {
            await connection.beginTransaction();

            // Query untuk mengambil detail order, layanan (items), dan info customer
            const [rows] = await connection.execute(
                `SELECT 
                    o.id AS order_id, 
                    o.items, 
                    o.building_type, 
                    o.schedule_date, 
                    o.schedule_time, 
                    o.address, 
                    o.notes,
                    o.total_price,
                    u.full_name, 
                    u.email, 
                    u.phone
                 FROM payments p
                 JOIN orders o ON p.order_id = o.id
                 JOIN users u ON o.customer_id = u.id
                 WHERE p.transaction_id = ? AND p.payment_status = 'pending'`,
                [partner_reff]
            );

            if (rows.length > 0) {
                const order = rows[0];

                // 1. Update status transaksi
                await connection.execute(
                    "UPDATE payments SET payment_status = 'settlement', transaction_time = NOW() WHERE transaction_id = ?",
                    [partner_reff]
                );
                await connection.execute(
                    "UPDATE orders SET status = 'accepted' WHERE id = ?",
                    [order.order_id]
                );
                await connection.execute(
                    "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'accepted', 'Pembayaran berhasil dikonfirmasi')",
                    [order.order_id]
                );

                await connection.commit();

                // 2. Parsing Data Layanan (Items)
                // Jika di DB disimpan sebagai JSON string, kita parse dulu
                const layananTerpilih = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;

                // 3. Susun Data untuk Email
                const emailPayload = {
                    orderId: order.order_id,
                    customer: {
                        nama: order.full_name,
                        email: order.email,
                        wa: order.phone
                    },
                    layanan: layananTerpilih, // Isinya array [{id, nama, qty, hargaSatuan}]
                    properti: {
                        jenisGedung: order.building_type,
                        jadwal: `${order.schedule_date} | ${order.schedule_time}`,
                        alamat: order.address,
                        catatan: order.notes || "-"
                    },
                    pembayaran: {
                        total: `Rp${parseInt(amount).toLocaleString('id-ID')}`,
                        metode: "Payment Gateway",
                        reff: partner_reff
                    }
                };

                // 4. Kirim Email
                // Email ke Customer
                await sendInvoiceEmail(order.email, emailPayload, true);

                // Email ke Admin (Copy)
                await sendInvoiceEmail(process.env.DEFAULT_EMAIL, { ...emailPayload, isAdmin: true }, true);

                console.log(`✅ Callback sukses: Order #${order.order_id} lunas.`);
            }
        }
        res.status(200).send("OK");
    } catch (err) {
        if (connection) await connection.rollback();
        console.error("❌ Callback Error:", err.message);
        res.status(500).send("Callback Error");
    } finally {
        if (connection) connection.release();
    }
};