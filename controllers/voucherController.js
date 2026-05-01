const db = require('../config/db');

// --- KODE ASLI ANDA (TIDAK DIUBAH) ---

exports.validateVoucher = async (req, res) => {
    const { code, user_id, subtotal_layanan } = req.body;

    if (!code || !user_id) {
        return res.status(400).json({ 
            success: false, 
            message: "Data tidak lengkap (kode atau user_id kosong)." 
        });
    }

    try {
        // 1. Cari voucher aktif
        const [vouchers] = await db.execute(
            "SELECT * FROM vouchers WHERE code = ? AND is_active = 1 AND (expired_at > NOW() OR expired_at IS NULL)",
            [code]
        );

        if (vouchers.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "Kode voucher tidak ditemukan atau sudah kedaluwarsa." 
            });
        }

        const v = vouchers[0];

        // 2. CEK LIMIT PENGGUNAAN (Dinamis berdasarkan v.usage_limit)
        const [usageCount] = await db.execute(
            "SELECT COUNT(*) as total FROM voucher_usages WHERE voucher_id = ? AND user_id = ?",
            [v.id, user_id]
        );

        const totalUsed = usageCount[0].total;
        const limit = v.usage_limit || 1; // Default 1 jika null

        if (totalUsed >= limit) {
            return res.status(400).json({ 
                success: false, 
                message: `Anda sudah mencapai batas maksimal penggunaan voucher ini (${limit}x).` 
            });
        }

        // 3. Cek Minimal Belanja
        const subtotal = parseFloat(subtotal_layanan || 0);
        const minPurchase = parseFloat(v.min_purchase || 0);

        if (subtotal < minPurchase) {
            return res.status(400).json({
                success: false,
                message: `Minimal belanja untuk voucher ini adalah Rp${parseInt(minPurchase).toLocaleString('id-ID')}`
            });
        }

        // 4. Hitung Diskon
        let discountAmount = Math.floor(subtotal * (v.discount_percent / 100));

        // 5. Batasi Maksimal Potongan
        if (v.max_discount_amount && v.max_discount_amount > 0) {
            const maxLimit = parseFloat(v.max_discount_amount);
            if (discountAmount > maxLimit) {
                discountAmount = maxLimit;
            }
        }

        res.status(200).json({
            success: true,
            message: "Voucher berhasil diterapkan!",
            data: {
                voucher_id: v.id,
                code: v.code,
                discount_amount: discountAmount,
                final_subtotal: subtotal - discountAmount,
                usage_info: `Penggunaan ke-${totalUsed + 1} dari ${limit}`
            }
        });

    } catch (error) {
        console.error("❌ Error Validasi Voucher:", error.message);
        res.status(500).json({ success: false, message: "Kesalahan server", error: error.message });
    }
};

exports.updateVoucher = async (req, res) => {
    const { id } = req.params;
    const { is_active, expired_at, min_purchase, code, max_discount_amount, usage_limit } = req.body;

    try {
        const [rows] = await db.execute("SELECT * FROM vouchers WHERE id = ?", [id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: "Voucher tidak ditemukan" });
        
        const oldData = rows[0];

        const updateData = {
            code: code !== undefined ? code : oldData.code,
            is_active: is_active !== undefined ? is_active : oldData.is_active,
            usage_limit: usage_limit !== undefined ? usage_limit : oldData.usage_limit,
            expired_at: expired_at !== undefined ? expired_at : oldData.expired_at,
            min_purchase: min_purchase !== undefined ? min_purchase : oldData.min_purchase,
            max_discount_amount: max_discount_amount !== undefined ? max_discount_amount : oldData.max_discount_amount
        };

        await db.execute(
            "UPDATE vouchers SET code = ?, is_active = ?, usage_limit = ?, expired_at = ?, min_purchase = ?, max_discount_amount = ? WHERE id = ?",
            [updateData.code, updateData.is_active, updateData.usage_limit, updateData.expired_at, updateData.min_purchase, updateData.max_discount_amount, id]
        );

        res.status(200).json({ success: true, message: "Voucher berhasil diperbarui" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getVouchers = async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT * FROM vouchers ORDER BY created_at DESC");
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// --- TAMBAHAN UNTUK OPERASI MASSAL (BULK) ---

/**
 * Membuat banyak voucher sekaligus
 * Body: { "vouchers": [ { "code": "PROMO1", ... }, { "code": "PROMO2", ... } ] }
 */
exports.bulkCreateVouchers = async (req, res) => {
    const { vouchers } = req.body;

    if (!Array.isArray(vouchers) || vouchers.length === 0) {
        return res.status(400).json({ success: false, message: "Data voucher harus berupa array." });
    }

    try {
        const values = vouchers.map(v => [
            v.code, 
            v.discount_type || 'percent', 
            v.discount_percent || 0, 
            v.max_discount_amount || null, 
            v.min_purchase || 0, 
            v.usage_limit || 1, 
            v.expired_at || null
        ]);

        const sql = `INSERT INTO vouchers 
            (code, discount_type, discount_percent, max_discount_amount, min_purchase, usage_limit, expired_at) 
            VALUES ?`;

        // Gunakan db.query untuk bulk insert
        await db.query(sql, [values]);

        res.status(201).json({ 
            success: true, 
            message: `${vouchers.length} voucher berhasil ditambahkan.` 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal membuat voucher massal", error: error.message });
    }
};

/**
 * Menghapus banyak voucher sekaligus berdasarkan ID
 * Body: { "ids": [1, 2, 3] }
 */
exports.bulkDeleteVouchers = async (req, res) => {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: "Pilih voucher yang ingin dihapus (array ID)." });
    }

    try {
        const sql = `DELETE FROM vouchers WHERE id IN (${ids.map(() => '?').join(',')})`;
        await db.execute(sql, ids);

        res.status(200).json({ 
            success: true, 
            message: `${ids.length} voucher berhasil dihapus.` 
        });
    } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({ 
                success: false, 
                message: "Beberapa voucher tidak bisa dihapus karena sudah pernah digunakan." 
            });
        }
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Mengubah status (aktif/non-aktif) banyak voucher sekaligus
 * Body: { "ids": [1, 2], "is_active": 0 }
 */
exports.bulkUpdateStatus = async (req, res) => {
    const { ids, is_active } = req.body;

    if (!Array.isArray(ids) || ids.length === 0 || is_active === undefined) {
        return res.status(400).json({ success: false, message: "Data tidak lengkap." });
    }

    try {
        const sql = `UPDATE vouchers SET is_active = ? WHERE id IN (${ids.map(() => '?').join(',')})`;
        await db.execute(sql, [is_active, ...ids]);

        res.status(200).json({ success: true, message: "Status voucher berhasil diperbarui." });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};