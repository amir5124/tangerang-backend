// controllers/artController.js
const db = require('../config/db');

// ============================================================
// ✅ DAFTAR STATUS VALID (SUMBER KEBENARAN TUNGGAL)
// Dipakai di updateStatusPesanan & updateMatchingStatus supaya
// tidak ada lagi 2 definisi yang beda seperti sebelumnya.
// ============================================================
const VALID_STATUS = [
    'pending', 'paid', 'matching', 'calling', 'working',
    'berangkat_dari_cicana', 'berangkat_cek_kesehatan', 'berangkat_siap_diantar',
    'approved', 'rejected', 'rejected_searching', 'completed', 'cancelled'
];

const VALID_MATCHING_STATUS = [
    'pending', 'matching', 'calling', 'working',
    'approved', 'rejected', 'rejected_searching'
];

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
                matching_status,
                gomeet_link,
                call_date,
                call_slot,
                departure_method,
                departure_date,
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
// GET: Pesanan by Customer (SEMUA pesanan customer)
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
// GET: Pesanan Aktif by Customer (hanya yang status aktif)
// ============================================================
const getActivePesananByCustomer = async (req, res) => {
    try {
        const { cust_id } = req.params;

        // ✅ FIX BUG POIN 5: sebelumnya hanya mengecek
        // status IN ('pending','paid','matching') sehingga saat status
        // sudah berubah ke 'approved'/'calling'/dst, pesanan "hilang" dari
        // daftar aktif dan user seolah dilempar balik ke halaman pesanan
        // kosong. Sekarang semua status yang BUKAN status akhir dianggap aktif.
        const [rows] = await db.query(`
            SELECT * FROM pesanan 
            WHERE cust_id = ? 
            AND status NOT IN ('completed', 'cancelled', 'rejected')
            ORDER BY created_at DESC
        `, [cust_id]);

        res.json({
            success: true,
            message: 'Data pesanan aktif customer berhasil diambil',
            data: rows,
            total: rows.length
        });
    } catch (error) {
        console.error('Error getActivePesananByCustomer:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data pesanan aktif customer',
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
// GET: Pesanan by Matching Status
// ============================================================
const getPesananByMatchingStatus = async (req, res) => {
    try {
        const { matching_status } = req.params;

        const [rows] = await db.query(`
            SELECT * FROM pesanan 
            WHERE matching_status = ? 
            ORDER BY created_at DESC
        `, [matching_status]);

        res.json({
            success: true,
            message: `Data pesanan dengan matching_status ${matching_status} berhasil diambil`,
            data: rows,
            total: rows.length
        });
    } catch (error) {
        console.error('Error getPesananByMatchingStatus:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data pesanan',
            error: error.message
        });
    }
};

// ============================================================
// GET: History status pesanan (untuk fitur "History Pesanan" di sisi user)
// ============================================================
const getPesananHistory = async (req, res) => {
    try {
        const { id } = req.params;

        const [existing] = await db.query(
            `SELECT id FROM pesanan WHERE id = ? OR order_id = ?`,
            [id, id]
        );
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan' });
        }

        // NOTE: sesuaikan nama kolom di bawah ini dengan struktur asli
        // tabel order_status_logs (jalankan `DESC order_status_logs;`
        // untuk konfirmasi nama kolomnya).
        const [logs] = await db.query(
            `SELECT * FROM order_status_logs 
             WHERE pesanan_id = ? 
             ORDER BY created_at ASC`,
            [existing[0].id]
        );

        res.json({
            success: true,
            message: 'History status pesanan berhasil diambil',
            data: logs
        });
    } catch (error) {
        console.error('Error getPesananHistory:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil history pesanan',
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
            status,
            matching_status
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
                status,
                matching_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            status || 'pending',
            matching_status || 'pending'
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
// PUT: Update pesanan (generic)
// ============================================================
const updatePesanan = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const [existing] = await db.query(`
            SELECT * FROM pesanan WHERE id = ? OR order_id = ?
        `, [id, id]);

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Pesanan tidak ditemukan'
            });
        }

        const fields = [];
        const values = [];

        Object.keys(updateData).forEach(key => {
            if (key !== 'id' && key !== 'order_id' && key !== 'created_at' && key !== 'updated_at') {
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
// HELPER: Insert log history status (dipanggil di updateStatusPesanan)
// Dibuat defensif: kalau tabel/kolomnya beda, tidak menggagalkan update utama.
// ============================================================
const logStatusChange = async (connection, pesananId, statusFrom, statusTo, note) => {
    try {
        await connection.query(
            `INSERT INTO order_status_logs (pesanan_id, status_from, status_to, note, created_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [pesananId, statusFrom, statusTo, note || null]
        );
    } catch (err) {
        // Sengaja tidak di-throw ulang: history adalah "nice to have",
        // jangan sampai gagal update status utama gara-gara logging error.
        console.warn(`⚠️ Gagal mencatat history status pesanan #${pesananId}:`, err.message);
    }
};

// ============================================================
// PUT: Update status pesanan
// ✅ Mendukung status baru + payload tambahan (Gomeet, jadwal call,
//    metode & tanggal keberangkatan) + history log
// ============================================================
const updateStatusPesanan = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            status,
            gomeet_link,
            call_date,
            call_slot,
            departure_method,
            departure_date,
            note
        } = req.body;

        // ✅ Validasi status pakai daftar tunggal di atas
        if (!VALID_STATUS.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Status tidak valid. Gunakan salah satu: ${VALID_STATUS.join(', ')}`
            });
        }

        // Validasi tambahan khusus per status
        if (status === 'calling') {
            if (!gomeet_link || !call_slot) {
                return res.status(400).json({
                    success: false,
                    message: 'gomeet_link dan call_slot wajib diisi untuk status calling'
                });
            }
        }
        if (status === 'berangkat_siap_diantar') {
            if (!departure_method || !['driver_online', 'dijemput_user'].includes(departure_method)) {
                return res.status(400).json({
                    success: false,
                    message: 'departure_method wajib diisi (driver_online / dijemput_user)'
                });
            }
            if (!departure_date) {
                return res.status(400).json({
                    success: false,
                    message: 'departure_date wajib diisi'
                });
            }
        }

        const [existing] = await db.query({
            sql: 'SELECT * FROM pesanan WHERE id = ? OR order_id = ?',
            timeout: 10000,
        }, [id, id]);

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Pesanan tidak ditemukan'
            });
        }

        const pesananRow = existing[0];
        const previousStatus = pesananRow.status;

        const connection = await db.getConnection();

        try {
            await connection.query('SET innodb_lock_wait_timeout = 10');
            await connection.beginTransaction();

            // ✅ Bangun SET clause dinamis berdasarkan field yang relevan
            const setFields = ['status = ?'];
            const setValues = [status];

            if (status === 'calling') {
                setFields.push('gomeet_link = ?', 'call_date = ?', 'call_slot = ?');
                setValues.push(gomeet_link, call_date || null, call_slot);
            }

            if (status === 'berangkat_siap_diantar') {
                setFields.push('departure_method = ?', 'departure_date = ?');
                setValues.push(departure_method, departure_date);
            }

            if (status === 'paid') {
                setFields.push('pay_status = ?', 'pay_at = NOW()');
                setValues.push('paid');
            }

            // ✅ Sinkronkan matching_status supaya tidak ada 2 sumber kebenaran
            // yang beda seperti sebelumnya (ini yang jadi sumber bug poin 5)
            const matchingSyncStatuses = ['matching', 'calling', 'working', 'approved', 'rejected', 'rejected_searching'];
            if (matchingSyncStatuses.includes(status)) {
                setFields.push('matching_status = ?');
                setValues.push(status);
            }

            setValues.push(pesananRow.id);

            await connection.query(
                `UPDATE pesanan SET ${setFields.join(', ')} WHERE id = ?`,
                setValues
            );

            await connection.commit();

            // Catat history (di luar transaksi utama, defensif)
            await logStatusChange(connection, pesananRow.id, previousStatus, status, note);

            const [updated] = await db.query(
                'SELECT * FROM pesanan WHERE id = ?',
                [pesananRow.id]
            );

            res.json({
                success: true,
                message: `Status pesanan berhasil diupdate menjadi ${status}`,
                data: updated[0]
            });

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

    } catch (error) {
        console.error('Error updateStatusPesanan:', error);

        if (error.code === 'ER_LOCK_WAIT_TIMEOUT') {
            return res.status(409).json({
                success: false,
                message: 'Terjadi konflik pada database. Silakan coba lagi.',
                error: 'Database lock timeout'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Gagal mengupdate status pesanan',
            error: error.message
        });
    }
};

// ============================================================
// PUT: Update matching status
// ✅ Konsisten pakai VALID_MATCHING_STATUS, termasuk rejected_searching
// ============================================================
const updateMatchingStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { matching_status } = req.body;

        if (!VALID_MATCHING_STATUS.includes(matching_status)) {
            return res.status(400).json({
                success: false,
                message: `Matching status tidak valid. Gunakan: ${VALID_MATCHING_STATUS.join(', ')}`
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

        // ✅ Status utama SELALU disamakan dengan matching_status untuk
        // status2 yang relevan (bukan cuma approved/rejected seperti sebelumnya)
        const statusSyncable = ['matching', 'calling', 'working', 'approved', 'rejected', 'rejected_searching'];
        const statusUpdate = statusSyncable.includes(matching_status) ? ', status = ?' : '';
        const params = statusSyncable.includes(matching_status)
            ? [matching_status, matching_status, existing[0].id]
            : [matching_status, existing[0].id];

        await db.query(`
            UPDATE pesanan 
            SET matching_status = ? ${statusUpdate}
            WHERE id = ?
        `, params);

        const [updated] = await db.query(`
            SELECT * FROM pesanan WHERE id = ?
        `, [existing[0].id]);

        res.json({
            success: true,
            message: `Matching status berhasil diupdate menjadi ${matching_status}`,
            data: updated[0]
        });
    } catch (error) {
        console.error('Error updateMatchingStatus:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengupdate matching status',
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
        const [statusStats] = await db.query(`
            SELECT 
                status,
                COUNT(*) AS total
            FROM pesanan
            GROUP BY status
        `);

        const [matchingStats] = await db.query(`
            SELECT 
                matching_status,
                COUNT(*) AS total
            FROM pesanan
            GROUP BY matching_status
        `);

        const [revenue] = await db.query(`
            SELECT 
                SUM(total) AS total_pendapatan,
                COUNT(*) AS total_pesanan_selesai,
                AVG(total) AS rata_rata
            FROM pesanan
            WHERE status IN ('paid', 'completed', 'approved')
        `);

        const [topWorkers] = await db.query(`
            SELECT 
                worker_nama,
                COUNT(*) AS total_pesanan,
                SUM(total) AS total_pendapatan
            FROM pesanan
            WHERE status IN ('paid', 'completed', 'approved')
            GROUP BY worker_nama
            ORDER BY total_pendapatan DESC
            LIMIT 5
        `);

        const [topCustomers] = await db.query(`
            SELECT 
                cust_nama,
                COUNT(*) AS total_pesanan,
                SUM(total) AS total_belanja
            FROM pesanan
            WHERE status IN ('paid', 'completed', 'approved')
            GROUP BY cust_nama
            ORDER BY total_belanja DESC
            LIMIT 5
        `);

        const [paymentMethods] = await db.query(`
            SELECT 
                metode_bayar,
                COUNT(*) AS total_transaksi,
                SUM(total) AS total_nominal
            FROM pesanan
            WHERE status IN ('paid', 'completed', 'approved')
            GROUP BY metode_bayar
            ORDER BY total_transaksi DESC
        `);

        res.json({
            success: true,
            message: 'Statistik pesanan berhasil diambil',
            data: {
                status_stats: statusStats,
                matching_stats: matchingStats,
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
            AND status IN ('paid', 'completed', 'approved')
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
    getActivePesananByCustomer,
    getPesananByWorker,
    getPesananByStatus,
    getPesananByMatchingStatus,
    getPesananHistory,
    createPesanan,
    updatePesanan,
    updateStatusPesanan,
    updateMatchingStatus,
    deletePesanan,
    getStatistikPesanan,
    getLaporanPerTanggal
};