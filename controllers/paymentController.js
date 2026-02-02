const db = require('../config/db');
const linkqu = require('../services/linkquService');
const helpers = require('../utils/helpers');
const { sendInvoiceEmail } = require('../utils/emailService');

exports.createPayment = async (req, res) => {
    try {
        const { nama, email, item, amount, method, biayaAdmin, catatan } = req.body;
        const partner_reff = helpers.generatePartnerReff();
        const isQRIS = method === 'QRIS';
        const expired = helpers.getExpiredTimestamp(isQRIS ? 30 : 1440);
        const finalEmail = helpers.isValidEmail(email) ? email : process.env.DEFAULT_EMAIL;

        const payload = {
            amount, partner_reff, expired, method,
            nama, email: finalEmail,
            customer_id: nama, customer_name: nama, customer_email: finalEmail,
            url_callback: process.env.CALLBACK_URL
        };

        let response;
        if (isQRIS) {
            response = await linkqu.createQRIS(payload);
        } else {
            response = await linkqu.createVA(payload);
        }

        // Simpan ke database
        const sql = `INSERT INTO orders (nama_paket, total_bayar, nama_user, email, metode_pembayaran, partner_reff, virtual_account, qris_image_url, waktu_expired, status_pembayaran, catatan) VALUES (?,?,?,?,?,?,?,?,?,?,?)`;

        await db.execute(sql, [
            item, amount, nama, finalEmail, isQRIS ? 'QRIS' : 'VA',
            partner_reff,
            isQRIS ? null : response.data.virtual_account,
            isQRIS ? response.data.imageqris : null,
            moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss'),
            'PENDING', catatan || null
        ]);

        res.json(response.data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
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