// controllers/artController.js
const db = require('../config/db'); // Sesuaikan dengan konfigurasi DB lo

// ============================================================
// GET: Semua pesanan
// ============================================================
const getAllPesanan = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                id,
                order_id,
                cust_id,
                cust_nama,
                cust_email,
                cust_hp,
                cust_nik,
                alamat,
                lat,
                lng,
                kontak_nama,
                kontak_email,
                kontak_wa,
                kontak_nik,
                worker_id,
                worker_nama,
                worker_umur,
                worker_asal,
                worker_exp,
                worker_gaji_min,
                worker_gaji_max,
                worker_level,
                worker_layanan,
                worker_kategori,
                worker_foto,
                worker_ready,
                DATE_FORMAT(tgl, '%Y-%m-%d') AS tgl,
                TIME_FORMAT(jam, '%H:%i') AS jam,
                store_id,
                metode_bayar,
                jenis_gedung,
                kategori,
                catatan,
                kode_voucher,
                layanan,
                sub_total,
                biaya_app,
                biaya_trans,
                diskon,
                total,
                pay_id,
                pay_method,
                pay_status,
                pay_data,
                pay_at,
                expired_at,
                voc_diskon,
                voc_type,
                voc_valid,
                status,
                created_at,
                updated_at
            FROM pesanan
            ORDER BY created_at DESC
        `);

        res.json({
            success: true,
            message: 'Data pesanan berhasil diambil',
            data: rows,
            total: rows.length
        });
    } catch (error) {
        console.error('Error getAllPesanan:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data pesanan',
            error: error.message
        });
    }
};

// ============================================================
// GET: Pesanan by ID
// ============================================================
const getPesananById = async (req, res) => {
    try {
        const { id } = req.params;

        const [rows] = await db.query(`
            SELECT * FROM pesanan WHERE id = ? OR order_id = ?
        `, [id, id]);

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Pesanan tidak ditemukan'
            });
        }

        res.json({
            success: true,
            message: 'Data pesanan ditemukan',
            data: rows[0]
        });
    } catch (error) {
        console.error('Error getPesananById:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data pesanan',
            error: error.message
        });
    }
};

// ============================================================
// GET: Pesanan by Customer
// ============================================================
const getPesananByCustomer = async (req, res) => {
    try {
        const { cust_id } = req.params;

        const [rows] = await db.query(`
            SELECT * FROM pesanan 
            WHERE cust_id = ? 
            ORDER BY created_at DESC
        `, [cust_id]);

        res.json({
            success: true,
            message: 'Data pesanan customer berhasil diambil',
            data: rows,
            total: rows.length
        });
    } catch (error) {
        console.error('Error getPesananByCustomer:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data pesanan customer',
            error: error.message
        });
    }
};

// ============================================================
// GET: Pesanan by Worker
// ============================================================
const getPesananByWorker = async (req, res) => {
    try {
        const { worker_id } = req.params;

        const [rows] = await db.query(`
            SELECT * FROM pesanan 
            WHERE worker_id = ? 
            ORDER BY created_at DESC
        `, [worker_id]);

        res.json({
            success: true,
            message: 'Data pesanan pekerja berhasil diambil',
            data: rows,
            total: rows.length
        });
    } catch (error) {
        console.error('Error getPesananByWorker:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data pesanan pekerja',
            error: error.message
        });
    }
};

// ============================================================
// GET: Pesanan by Status
// ============================================================
const getPesananByStatus = async (req, res) => {
    try {
        const { status } = req.params;

        const [rows] = await db.query(`
            SELECT * FROM pesanan 
            WHERE status = ? 
            ORDER BY created_at DESC
        `, [status]);

        res.json({
            success: true,
            message: `Data pesanan dengan status ${status} berhasil diambil`,
            data: rows,
            total: rows.length
        });
    } catch (error) {
        console.error('Error getPesananByStatus:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data pesanan',
            error: error.message
        });
    }
};

// ============================================================
// POST: Buat pesanan baru
// ============================================================
const createPesanan = async (req, res) => {
    try {
        const {
            order_id,
            cust_id,
            cust_nama,
            cust_email,
            cust_hp,
            cust_nik,
            alamat,
            lat,
            lng,
            kontak_nama,
            kontak_email,
            kontak_wa,
            kontak_nik,
            worker_id,
            worker_nama,
            worker_umur,
            worker_asal,
            worker_exp,
            worker_gaji_min,
            worker_gaji_max,
            worker_level,
            worker_layanan,
            worker_kategori,
            worker_foto,
            worker_ready,
            tgl,
            jam,
            store_id,
            metode_bayar,
            jenis_gedung,
            kategori,
            catatan,
            kode_voucher,
            layanan,
            sub_total,
            biaya_app,
            biaya_trans,
            diskon,
            total,
            pay_method,
            pay_status,
            status
        } = req.body;

        // Generate order_id jika tidak ada
        const finalOrderId = order_id || `ORD-${Date.now()}-${Math.floor(Math.random() * 9999)}`;

        const [result] = await db.query(`
            INSERT INTO pesanan (
                order_id,
                cust_id,
                cust_nama,
                cust_email,
                cust_hp,
                cust_nik,
                alamat,
                lat,
                lng,
                kontak_nama,
                kontak_email,
                kontak_wa,
                kontak_nik,
                worker_id,
                worker_nama,
                worker_umur,
                worker_asal,
                worker_exp,
                worker_gaji_min,
                worker_gaji_max,
                worker_level,
                worker_layanan,
                worker_kategori,
                worker_foto,
                worker_ready,
                tgl,
                jam,
                store_id,
                metode_bayar,
                jenis_gedung,
                kategori,
                catatan,
                kode_voucher,
                layanan,
                sub_total,
                biaya_app,
                biaya_trans,
                diskon,
                total,
                pay_method,
                pay_status,
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            finalOrderId,
            cust_id,
            cust_nama,
            cust_email,
            cust_hp,
            cust_nik,
            alamat,
            lat,
            lng,
            kontak_nama,
            kontak_email,
            kontak_wa,
            kontak_nik,
            worker_id,
            worker_nama,
            worker_umur,
            worker_asal,
            worker_exp,
            worker_gaji_min,
            worker_gaji_max,
            worker_level,
            worker_layanan,
            worker_kategori,
            worker_foto,
            worker_ready || false,
            tgl,
            jam,
            store_id,
            metode_bayar,
            jenis_gedung,
            kategori,
            catatan,
            kode_voucher,
            layanan,
            sub_total || 0,
            biaya_app || 0,
            biaya_trans || 0,
            diskon || 0,
            total || 0,
            pay_method,
            pay_status || 'unpaid',
            status || 'pending'
        ]);

        const [newOrder] = await db.query(`
            SELECT * FROM pesanan WHERE id = ?
        `, [result.insertId]);

        res.status(201).json({
            success: true,
            message: 'Pesanan berhasil dibuat',
            data: newOrder[0]
        });
    } catch (error) {
        console.error('Error createPesanan:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal membuat pesanan',
            error: error.message
        });
    }
};

// ============================================================
// PUT: Update pesanan
// ============================================================
const updatePesanan = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        // Cek apakah pesanan ada
        const [existing] = await db.query(`
            SELECT * FROM pesanan WHERE id = ? OR order_id = ?
        `, [id, id]);

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Pesanan tidak ditemukan'
            });
        }

        // Build query dinamis
        const fields = [];
        const values = [];

        Object.keys(updateData).forEach(key => {
            if (key !== 'id' && key !== 'order_id' && key !== 'created_at') {
                fields.push(`${key} = ?`);
                values.push(updateData[key]);
            }
        });

        if (fields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Tidak ada data yang diupdate'
            });
        }

        values.push(existing[0].id);

        await db.query(`
            UPDATE pesanan SET ${fields.join(', ')} WHERE id = ?
        `, values);

        const [updated] = await db.query(`
            SELECT * FROM pesanan WHERE id = ?
        `, [existing[0].id]);

        res.json({
            success: true,
            message: 'Pesanan berhasil diupdate',
            data: updated[0]
        });
    } catch (error) {
        console.error('Error updatePesanan:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengupdate pesanan',
            error: error.message
        });
    }
};

// ============================================================
// PUT: Update status pesanan
// ============================================================
const updateStatusPesanan = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const validStatus = ['pending', 'paid', 'completed', 'cancelled'];
        if (!validStatus.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Status tidak valid. Gunakan: pending, paid, completed, cancelled'
            });
        }

        const [existing] = await db.query(`
            SELECT * FROM pesanan WHERE id = ? OR order_id = ?
        `, [id, id]);

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Pesanan tidak ditemukan'
            });
        }

        await db.query(`
            UPDATE pesanan SET status = ? WHERE id = ?
        `, [status, existing[0].id]);

        // Jika status paid, update pay_status dan pay_at
        if (status === 'paid') {
            await db.query(`
                UPDATE pesanan SET pay_status = 'paid', pay_at = NOW() WHERE id = ?
            `, [existing[0].id]);
        }

        const [updated] = await db.query(`
            SELECT * FROM pesanan WHERE id = ?
        `, [existing[0].id]);

        res.json({
            success: true,
            message: `Status pesanan berhasil diupdate menjadi ${status}`,
            data: updated[0]
        });
    } catch (error) {
        console.error('Error updateStatusPesanan:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengupdate status pesanan',
            error: error.message
        });
    }
};

// ============================================================
// DELETE: Hapus pesanan
// ============================================================
const deletePesanan = async (req, res) => {
    try {
        const { id } = req.params;

        const [existing] = await db.query(`
            SELECT * FROM pesanan WHERE id = ? OR order_id = ?
        `, [id, id]);

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Pesanan tidak ditemukan'
            });
        }

        await db.query(`
            DELETE FROM pesanan WHERE id = ?
        `, [existing[0].id]);

        res.json({
            success: true,
            message: 'Pesanan berhasil dihapus',
            data: existing[0]
        });
    } catch (error) {
        console.error('Error deletePesanan:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal menghapus pesanan',
            error: error.message
        });
    }
};

// ============================================================
// GET: Statistik pesanan
// ============================================================
const getStatistikPesanan = async (req, res) => {
    try {
        // Total pesanan per status
        const [statusStats] = await db.query(`
            SELECT 
                status,
                COUNT(*) AS total
            FROM pesanan
            GROUP BY status
        `);

        // Total pendapatan
        const [revenue] = await db.query(`
            SELECT 
                SUM(total) AS total_pendapatan,
                COUNT(*) AS total_pesanan_selesai,
                AVG(total) AS rata_rata
            FROM pesanan
            WHERE status IN ('paid', 'completed')
        `);

        // Top 5 pekerja terlaris
        const [topWorkers] = await db.query(`
            SELECT 
                worker_nama,
                COUNT(*) AS total_pesanan,
                SUM(total) AS total_pendapatan
            FROM pesanan
            WHERE status IN ('paid', 'completed')
            GROUP BY worker_nama
            ORDER BY total_pendapatan DESC
            LIMIT 5
        `);

        // Top 5 customer
        const [topCustomers] = await db.query(`
            SELECT 
                cust_nama,
                COUNT(*) AS total_pesanan,
                SUM(total) AS total_belanja
            FROM pesanan
            WHERE status IN ('paid', 'completed')
            GROUP BY cust_nama
            ORDER BY total_belanja DESC
            LIMIT 5
        `);

        // Metode pembayaran favorit
        const [paymentMethods] = await db.query(`
            SELECT 
                metode_bayar,
                COUNT(*) AS total_transaksi,
                SUM(total) AS total_nominal
            FROM pesanan
            WHERE status IN ('paid', 'completed')
            GROUP BY metode_bayar
            ORDER BY total_transaksi DESC
        `);

        res.json({
            success: true,
            message: 'Statistik pesanan berhasil diambil',
            data: {
                status_stats: statusStats,
                revenue: revenue[0] || { total_pendapatan: 0, total_pesanan_selesai: 0, rata_rata: 0 },
                top_workers: topWorkers,
                top_customers: topCustomers,
                payment_methods: paymentMethods
            }
        });
    } catch (error) {
        console.error('Error getStatistikPesanan:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil statistik pesanan',
            error: error.message
        });
    }
};

// ============================================================
// GET: Laporan per tanggal
// ============================================================
const getLaporanPerTanggal = async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        if (!start_date || !end_date) {
            return res.status(400).json({
                success: false,
                message: 'Parameter start_date dan end_date wajib diisi'
            });
        }

        const [rows] = await db.query(`
            SELECT 
                DATE(tgl) AS tanggal,
                COUNT(*) AS total_pesanan,
                SUM(total) AS total_pendapatan,
                AVG(total) AS rata_rata,
                COUNT(DISTINCT cust_id) AS pelanggan_unik
            FROM pesanan
            WHERE tgl BETWEEN ? AND ?
            AND status IN ('paid', 'completed')
            GROUP BY DATE(tgl)
            ORDER BY tanggal DESC
        `, [start_date, end_date]);

        res.json({
            success: true,
            message: 'Laporan per tanggal berhasil diambil',
            data: rows,
            total: rows.length
        });
    } catch (error) {
        console.error('Error getLaporanPerTanggal:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil laporan per tanggal',
            error: error.message
        });
    }
};

// ============================================================
// EXPORT MODULE
// ============================================================
module.exports = {
    getAllPesanan,
    getPesananById,
    getPesananByCustomer,
    getPesananByWorker,
    getPesananByStatus,
    createPesanan,
    updatePesanan,
    updateStatusPesanan,
    deletePesanan,
    getStatistikPesanan,
    getLaporanPerTanggal
};