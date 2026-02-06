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

exports.getOrderDetail = async (req, res) => {
    try {
        const { id } = req.params;
        const sql = `
            SELECT 
                o.id, 
                o.status, 
                o.scheduled_date, 
                o.scheduled_time, 
                o.address_customer, 
                o.building_type,
                u.full_name AS customer_name, 
                u.phone_number,
                -- Mengambil items dan menjadikannya JSON string agar bisa di-parse Frontend
                (SELECT JSON_ARRAYAGG(
                    JSON_OBJECT(
                        'nama', service_name,
                        'qty', qty,
                        'hargaSatuan', price_satuan
                    )
                ) FROM order_items WHERE order_id = o.id) AS items
            FROM orders o
            JOIN users u ON o.customer_id = u.id
            WHERE o.id = ?`;

        const [rows] = await db.execute(sql, [id]);

        if (rows.length === 0) return res.status(404).json({ message: "Order tidak ditemukan" });

        res.status(200).json(rows[0]);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.updateOrderStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // status dikirim dari frontend (e.g., 'on_the_way')
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Update status di tabel orders
        const sqlUpdate = "UPDATE orders SET status = ? WHERE id = ?";
        await connection.execute(sqlUpdate, [status, id]);

        // 2. Jika status 'completed' dan ada file, simpan informasi foto
        let photoPath = null;
        if (status === 'completed' && req.file) {
            photoPath = req.file.path;
            // Opsional: Simpan path foto ke kolom 'completion_image' di tabel orders jika ada
            await connection.execute(
                "UPDATE orders SET completion_image = ? WHERE id = ?",
                [photoPath, id]
            );
        }

        // 3. Catat history di tabel order_status_logs
        const sqlLog = "INSERT INTO order_status_logs (order_id, status, notes) VALUES (?, ?, ?)";
        const notes = `Status diperbarui menjadi ${status} oleh Mitra`;
        await connection.execute(sqlLog, [id, status, notes]);

        await connection.commit();
        res.status(200).json({
            success: true,
            message: `Status berhasil diperbarui ke ${status}`,
            image_path: photoPath
        });

    } catch (error) {
        await connection.rollback();
        console.error("Update Status Error:", error);
        res.status(500).json({ success: false, message: error.message });
    } finally {
        connection.release();
    }
};