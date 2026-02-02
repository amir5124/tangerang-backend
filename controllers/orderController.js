const db = require('../config/db'); // Sesuaikan dengan koneksi database kamu

exports.createOrder = async (req, res) => {
    const {
        customer_id, store_id, metode_pembayaran, jenisGedung,
        jadwal, lokasi, rincian_biaya, layananTerpilih, catatan
    } = req.body;

    // Mulai Transaksi Database
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        // 1. Simpan ke tabel 'orders'
        const sqlOrder = `INSERT INTO orders 
            (customer_id, store_id, scheduled_date, scheduled_time, building_type, address_customer, total_price, platform_fee, service_fee, status, customer_notes) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`;

        const [orderResult] = await connection.execute(sqlOrder, [
            customer_id,
            store_id,
            jadwal.tanggal,
            jadwal.waktu,
            jenisGedung,
            lokasi.alamatLengkap,
            rincian_biaya.subtotal_layanan,
            rincian_biaya.biaya_layanan_app,
            rincian_biaya.biaya_transaksi,
            catatan
        ]);

        const newOrderId = orderResult.insertId;

        // 2. Simpan ke tabel 'order_items' (Looping array layananTerpilih)
        const sqlItem = `INSERT INTO order_items (order_id, service_name, qty, price_satuan, subtotal) VALUES (?, ?, ?, ?, ?)`;
        for (const item of layananTerpilih) {
            await connection.execute(sqlItem, [
                newOrderId,
                item.nama,
                item.qty,
                item.hargaSatuan,
                (item.qty * item.hargaSatuan)
            ]);
        }

        // 3. Simpan ke tabel 'payments'
        // Catatan: Memetakan QRIS ke 'midtrans' agar sesuai ENUM database kamu
        const method = metode_pembayaran === 'QRIS' ? 'midtrans' : 'manual_transfer';
        const sqlPayment = `INSERT INTO payments (order_id, customer_id, payment_method, gross_amount, payment_status) VALUES (?, ?, ?, ?, 'pending')`;
        await connection.execute(sqlPayment, [newOrderId, customer_id, method, rincian_biaya.total_akhir]);

        // Commit Transaksi
        await connection.commit();
        res.status(201).json({
            success: true,
            message: "Order created successfully",
            order_id: newOrderId
        });

    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to create order", error: error.message });
    } finally {
        connection.release();
    }
};