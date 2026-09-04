// controllers/complaintController.js
const db = require('../config/db');

// ============================================================
// POST: Customer mengajukan komplain atas sebuah pesanan
// ============================================================
const createComplaint = async (req, res) => {
    try {
        const { pesanan_id, cust_id, reason } = req.body;

        if (!pesanan_id || !cust_id || !reason || !reason.trim()) {
            return res.status(400).json({
                success: false,
                message: 'pesanan_id, cust_id, dan reason wajib diisi'
            });
        }

        const [pesananRows] = await db.query(
            `SELECT id, cust_id FROM pesanan WHERE id = ? OR order_id = ?`,
            [pesanan_id, pesanan_id]
        );

        if (pesananRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan' });
        }

        const pesanan = pesananRows[0];

        if (String(pesanan.cust_id) !== String(cust_id)) {
            return res.status(403).json({
                success: false,
                message: 'Pesanan ini bukan milik customer tersebut'
            });
        }

        // Cegah komplain ganda yang masih pending untuk pesanan yang sama
        const [existingPending] = await db.query(
            `SELECT id FROM pesanan_complaints WHERE pesanan_id = ? AND status = 'pending'`,
            [pesanan.id]
        );
        if (existingPending.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Sudah ada komplain untuk pesanan ini yang masih menunggu review admin'
            });
        }

        const [result] = await db.query(
            `INSERT INTO pesanan_complaints (pesanan_id, cust_id, reason, status)
             VALUES (?, ?, ?, 'pending')`,
            [pesanan.id, cust_id, reason.trim()]
        );

        const [created] = await db.query(
            `SELECT * FROM pesanan_complaints WHERE id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Komplain berhasil diajukan, menunggu review admin',
            data: created[0]
        });
    } catch (error) {
        console.error('Error createComplaint:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengajukan komplain',
            error: error.message
        });
    }
};

// ============================================================
// GET: Semua komplain (admin) — optional filter ?status=pending
// ============================================================
const getAllComplaints = async (req, res) => {
    try {
        const { status } = req.query;

        const params = [];
        let sql = `
            SELECT c.*, p.order_id, p.total, p.worker_gaji_min, p.worker_nama
            FROM pesanan_complaints c
            JOIN pesanan p ON p.id = c.pesanan_id
        `;
        if (status) {
            sql += ` WHERE c.status = ?`;
            params.push(status);
        }
        sql += ` ORDER BY c.created_at DESC`;

        const [rows] = await db.query(sql, params);

        res.json({
            success: true,
            message: 'Data komplain berhasil diambil',
            data: rows,
            total: rows.length
        });
    } catch (error) {
        console.error('Error getAllComplaints:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data komplain',
            error: error.message
        });
    }
};

// ============================================================
// GET: Komplain by customer (riwayat komplain milik user)
// ============================================================
const getComplaintsByCustomer = async (req, res) => {
    try {
        const { cust_id } = req.params;

        const [rows] = await db.query(
            `SELECT c.*, p.order_id, p.worker_nama
             FROM pesanan_complaints c
             JOIN pesanan p ON p.id = c.pesanan_id
             WHERE c.cust_id = ?
             ORDER BY c.created_at DESC`,
            [cust_id]
        );

        res.json({
            success: true,
            message: 'Data komplain customer berhasil diambil',
            data: rows,
            total: rows.length
        });
    } catch (error) {
        console.error('Error getComplaintsByCustomer:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data komplain customer',
            error: error.message
        });
    }
};

// ============================================================
// GET: Komplain by ID
// ============================================================
const getComplaintById = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query(`SELECT * FROM pesanan_complaints WHERE id = ?`, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Komplain tidak ditemukan' });
        }

        res.json({ success: true, message: 'Data komplain ditemukan', data: rows[0] });
    } catch (error) {
        console.error('Error getComplaintById:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data komplain',
            error: error.message
        });
    }
};

// ============================================================
// PUT: Admin approve komplain → otomatis terbitkan voucher
// diskon (default 100% / gratis) untuk biaya kandidat (worker_gaji_min)
// di ORDER BERIKUTNYA milik customer tsb.
// ============================================================
const approveComplaint = async (req, res) => {
    try {
        const { id } = req.params;
        const { admin_note, resolved_by, discount_percent } = req.body;

        const [rows] = await db.query(`SELECT * FROM pesanan_complaints WHERE id = ?`, [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Komplain tidak ditemukan' });
        }

        const complaint = rows[0];

        if (complaint.status !== 'pending') {
            return res.status(409).json({
                success: false,
                message: `Komplain sudah pernah diproses (status saat ini: ${complaint.status})`
            });
        }

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            await connection.query(
                `UPDATE pesanan_complaints
                 SET status = 'approved', admin_note = ?, resolved_by = ?, resolved_at = NOW()
                 WHERE id = ?`,
                [admin_note || null, resolved_by || null, complaint.id]
            );

            // 🔥 Terbitkan voucher — otomatis dipakai di order berikutnya
            // (lihat createPesanan di artController.js)
            await connection.query(
                `INSERT INTO cust_discount_vouchers
                    (cust_id, complaint_id, discount_type, discount_percent, is_used)
                 VALUES (?, ?, 'worker_gaji_min_percent', ?, 0)`,
                [complaint.cust_id, complaint.id, discount_percent || 100.0]
            );

            await connection.commit();

            const [updated] = await db.query(`SELECT * FROM pesanan_complaints WHERE id = ?`, [complaint.id]);

            res.json({
                success: true,
                message: 'Komplain disetujui, voucher diskon kandidat gratis untuk order berikutnya sudah diterbitkan',
                data: updated[0]
            });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error approveComplaint:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal menyetujui komplain',
            error: error.message
        });
    }
};

// ============================================================
// PUT: Admin reject komplain
// ============================================================
const rejectComplaint = async (req, res) => {
    try {
        const { id } = req.params;
        const { admin_note, resolved_by } = req.body;

        const [rows] = await db.query(`SELECT * FROM pesanan_complaints WHERE id = ?`, [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Komplain tidak ditemukan' });
        }
        if (rows[0].status !== 'pending') {
            return res.status(409).json({
                success: false,
                message: `Komplain sudah pernah diproses (status saat ini: ${rows[0].status})`
            });
        }

        await db.query(
            `UPDATE pesanan_complaints
             SET status = 'rejected', admin_note = ?, resolved_by = ?, resolved_at = NOW()
             WHERE id = ?`,
            [admin_note || null, resolved_by || null, id]
        );

        const [updated] = await db.query(`SELECT * FROM pesanan_complaints WHERE id = ?`, [id]);

        res.json({
            success: true,
            message: 'Komplain ditolak',
            data: updated[0]
        });
    } catch (error) {
        console.error('Error rejectComplaint:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal menolak komplain',
            error: error.message
        });
    }
};

// ============================================================
// GET: Cek apakah customer punya voucher diskon aktif (belum dipakai)
// Dipanggil dari frontend untuk menampilkan banner "kandidat gratis"
// sebelum user bikin order baru.
// ============================================================
const getActiveDiscountVoucher = async (req, res) => {
    try {
        const { cust_id } = req.params;

        const [rows] = await db.query(
            `SELECT * FROM cust_discount_vouchers
             WHERE cust_id = ? AND is_used = 0
             ORDER BY created_at ASC
             LIMIT 1`,
            [cust_id]
        );

        res.json({
            success: true,
            message: rows.length > 0 ? 'Customer punya voucher aktif' : 'Tidak ada voucher aktif',
            data: rows[0] || null
        });
    } catch (error) {
        console.error('Error getActiveDiscountVoucher:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengecek voucher diskon',
            error: error.message
        });
    }
};

// ============================================================
// GET: Komplain terbaru untuk sebuah pesanan (dipakai frontend
// untuk cek "sudah pernah komplain belum" & tampilkan statusnya)
// ============================================================
const getComplaintByPesananId = async (req, res) => {
    try {
        const { pesanan_id } = req.params;

        const [pesananRows] = await db.query(
            `SELECT id FROM pesanan WHERE id = ? OR order_id = ?`,
            [pesanan_id, pesanan_id]
        );
        if (pesananRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan' });
        }

        const [rows] = await db.query(
            `SELECT * FROM pesanan_complaints
             WHERE pesanan_id = ?
             ORDER BY created_at DESC
             LIMIT 1`,
            [pesananRows[0].id]
        );

        res.json({
            success: true,
            message: rows.length > 0 ? 'Komplain ditemukan' : 'Belum pernah komplain',
            data: rows[0] || null
        });
    } catch (error) {
        console.error('Error getComplaintByPesananId:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengecek status komplain',
            error: error.message
        });
    }
};

// ============================================================
// PUT: Tandai voucher diskon sudah dipakai (dipanggil FRONTEND
// setelah order baru berhasil dibuat, BUKAN dari createPesanan,
// supaya endpoint pembuatan pesanan tetap independen).
// ============================================================
const useDiscountVoucher = async (req, res) => {
    try {
        const { id } = req.params;
        const { pesanan_id } = req.body;

        const [rows] = await db.query(
            `SELECT * FROM cust_discount_vouchers WHERE id = ?`,
            [id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Voucher tidak ditemukan' });
        }
        if (rows[0].is_used) {
            return res.status(409).json({ success: false, message: 'Voucher sudah pernah dipakai' });
        }

        await db.query(
            `UPDATE cust_discount_vouchers
             SET is_used = 1, used_pesanan_id = ?, used_at = NOW()
             WHERE id = ?`,
            [pesanan_id || null, id]
        );

        const [updated] = await db.query(`SELECT * FROM cust_discount_vouchers WHERE id = ?`, [id]);

        res.json({
            success: true,
            message: 'Voucher berhasil ditandai sudah dipakai',
            data: updated[0]
        });
    } catch (error) {
        console.error('Error useDiscountVoucher:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal menandai voucher terpakai',
            error: error.message
        });
    }
};

module.exports = {
    createComplaint,
    getAllComplaints,
    getComplaintsByCustomer,
    getComplaintById,
    getComplaintByPesananId,
    approveComplaint,
    rejectComplaint,
    getActiveDiscountVoucher,
    useDiscountVoucher
};