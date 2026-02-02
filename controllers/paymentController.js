const db = require('../config/db');
const linkqu = require('../services/linkquService');
const helpers = require('../utils/helpers');
const { sendInvoiceEmail } = require('../utils/emailService');
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

        // 4. REQUEST KE LINKQU (TITIK RAWAN ERROR 403)
        const payload = {
            amount: rincian_biaya.total_akhir,
            partner_reff: partner_reff,
            expired: expired,
            method: metode_pembayaran,
            nama: kontak.nama,
            email: finalEmail
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
                amount: rincian_biaya.total_akhir
            }
        };

        console.log("DEBUG: Sending JSON Response to App:", JSON.stringify(responseData, null, 2));
        res.json(responseData);

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("!!! BACKEND CRASH ERROR !!!");
        console.error("Message:", err.message);
        console.error("Stack:", err.stack); // Menampilkan baris kode yang error
        res.status(500).json({
            success: false,
            message: "Internal Server Error",
            debug_message: err.message
        });
    } finally {
        connection.release();
        console.log("DEBUG: Connection Released");
        console.log("==========================================");
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