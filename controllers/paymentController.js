const db = require('../config/db');
const linkqu = require('../services/linkquService');
const helpers = require('../utils/helpers');
const { sendInvoiceEmail } = require('../utils/emailService');
const moment = require('moment-timezone');

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
        // Menggunakan kolom sesuai struktur DESCRIBE orders Anda
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

        // 2. Simpan ke tabel 'order_items'
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
            email: finalEmail
        };

        const linkquRes = isQRIS ? await linkqu.createQRIS(payload) : await linkqu.createVA(payload);

        if (!linkquRes.data || linkquRes.data.status !== 'SUCCESS') {
            throw new Error(linkquRes.data.message || "Gagal mendapatkan respon dari LinkQu");
        }

        // 4. Simpan ke tabel 'payments' 
        // Menggunakan gross_amount, payment_details, dan expired_at
        const sqlPayment = `INSERT INTO payments 
            (order_id, customer_id, payment_method, transaction_id, gross_amount, payment_status, payment_type, expired_at, payment_details) 
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`;

        const formattedExpired = moment.tz(expired, 'YYYYMMDDHHmmss', 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');

        await connection.execute(sqlPayment, [
            newOrderId,
            customer_id,
            metode_pembayaran,
            partner_reff,
            rincian_biaya.total_akhir,
            isQRIS ? 'QRIS' : 'VA',
            formattedExpired,
            JSON.stringify(linkquRes.data)
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
        console.error("Error Create Payment:", err.message);
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

            // SINKRONISASI KOLOM: address_customer, scheduled_date, customer_notes, phone_number
            const [rows] = await connection.execute(
                `SELECT 
                    o.id AS order_id, o.items, o.building_type, o.scheduled_date, 
                    o.scheduled_time, o.address_customer, o.customer_notes, o.total_price,
                    u.full_name, u.email, u.phone_number
                 FROM payments p
                 JOIN orders o ON p.order_id = o.id
                 JOIN users u ON o.customer_id = u.id
                 WHERE p.transaction_id = ? AND p.payment_status = 'pending'`,
                [partner_reff]
            );

            if (rows.length > 0) {
                const order = rows[0];

                // Update status transaksi
                await connection.execute(
                    "UPDATE payments SET payment_status = 'settlement', transaction_time = NOW() WHERE transaction_id = ?",
                    [partner_reff]
                );
                await connection.execute(
                    "UPDATE orders SET status = 'accepted' WHERE id = ?",
                    [order.order_id]
                );
                await connection.execute(
                    "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, 'accepted', 'Pembayaran berhasil dikonfirmasi via LinkQu')",
                    [order.order_id]
                );

                await connection.commit();

                // Parsing Items dan Kirim Email
                const layananTerpilih = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
                const emailPayload = {
                    orderId: order.order_id,
                    customer: { nama: order.full_name, email: order.email, wa: order.phone_number },
                    layanan: layananTerpilih,
                    properti: {
                        jenisGedung: order.building_type,
                        jadwal: `${moment(order.scheduled_date).format('DD-MM-YYYY')} | ${order.scheduled_time}`,
                        alamat: order.address_customer,
                        catatan: order.customer_notes || "-"
                    },
                    pembayaran: {
                        total: `Rp${parseInt(amount).toLocaleString('id-ID')}`,
                        metode: "LinkQu Payment",
                        reff: partner_reff
                    }
                };

                await sendInvoiceEmail(order.email, emailPayload, false);
                await sendInvoiceEmail(process.env.DEFAULT_EMAIL, { ...emailPayload, isAdmin: true }, true);

                console.log(`✅ Success: Order #${order.order_id} Paid.`);
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