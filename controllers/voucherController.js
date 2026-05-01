const db = require('../config/db');

/**
 * 1. VALIDASI VOUCHER
 * Digunakan untuk mengecek apakah voucher bisa digunakan saat checkout
 */
exports.validateVoucher = async (req, res) => {
    const { code, user_id, subtotal_layanan } = req.body;

    if (!code || !user_id) {
        return res.status(400).json({ 
            success: false, 
            message: "Data tidak lengkap (kode atau user_id kosong)." 
        });
    }

    try {
        // Cari voucher aktif, belum expired, dan ambil kolom baru (description, image_url)
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

        // CEK LIMIT PENGGUNAAN
        const [usageCount] = await db.execute(
            "SELECT COUNT(*) as total FROM voucher_usages WHERE voucher_id = ? AND user_id = ?",
            [v.id, user_id]
        );

        const totalUsed = usageCount[0].total;
        const limit = v.usage_limit || 1;

        if (totalUsed >= limit) {
            return res.status(400).json({ 
                success: false, 
                message: `Anda sudah mencapai batas maksimal penggunaan voucher ini (${limit}x).` 
            });
        }

        // CEK MINIMAL BELANJA
        const subtotal = parseFloat(subtotal_layanan || 0);
        const minPurchase = parseFloat(v.min_purchase || 0);

        if (subtotal < minPurchase) {
            return res.status(400).json({
                success: false,
                message: `Minimal belanja untuk voucher ini adalah Rp${parseInt(minPurchase).toLocaleString('id-ID')}`
            });
        }

        // HITUNG DISKON
        let discountAmount = Math.floor(subtotal * (v.discount_percent / 100));

        // BATASI MAKSIMAL POTONGAN
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
                description: v.description, // Menampilkan kata-kata promo
                image_url: v.image_url,     // Menampilkan gambar voucher
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

/**
 * 2. GET SEMUA VOUCHER
 */
exports.getVouchers = async (req, res) => {
    try {
        // Mengambil semua kolom termasuk description dan image_url
        const [rows] = await db.execute("SELECT * FROM vouchers ORDER BY created_at DESC");
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 3. UPDATE VOUCHER (SINGLE)
 */
exports.updateVoucher = async (req, res) => {
    const { id } = req.params;
    const { 
        is_active, expired_at, min_purchase, code, 
        max_discount_amount, usage_limit, description, image_url 
    } = req.body;

    try {
        const [rows] = await db.execute("SELECT * FROM vouchers WHERE id = ?", [id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: "Voucher tidak ditemukan" });
        
        const oldData = rows[0];

        const updateData = {
            code: code !== undefined ? code : oldData.code,
            description: description !== undefined ? description : oldData.description,
            image_url: image_url !== undefined ? image_url : oldData.image_url,
            is_active: is_active !== undefined ? is_active : oldData.is_active,
            usage_limit: usage_limit !== undefined ? usage_limit : oldData.usage_limit,
            expired_at: expired_at !== undefined ? expired_at : oldData.expired_at,
            min_purchase: min_purchase !== undefined ? min_purchase : oldData.min_purchase,
            max_discount_amount: max_discount_amount !== undefined ? max_discount_amount : oldData.max_discount_amount
        };

        await db.execute(
            `UPDATE vouchers SET 
            code = ?, description = ?, image_url = ?, is_active = ?, usage_limit = ?, 
            expired_at = ?, min_purchase = ?, max_discount_amount = ? 
            WHERE id = ?`,
            [
                updateData.code, updateData.description, updateData.image_url, 
                updateData.is_active, updateData.usage_limit, updateData.expired_at, 
                updateData.min_purchase, updateData.max_discount_amount, id
            ]
        );

        res.status(200).json({ success: true, message: "Voucher berhasil diperbarui" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 4. BULK CREATE VOUCHERS
 */
exports.bulkCreateVouchers = async (req, res) => {
    const { vouchers } = req.body;

    if (!Array.isArray(vouchers) || vouchers.length === 0) {
        return res.status(400).json({ success: false, message: "Data voucher harus berupa array." });
    }

    try {
        // Menambahkan description dan image_url ke dalam urutan kolom yang akan di-insert
        const values = vouchers.map(v => [
            v.code, 
            v.description || null,
            v.image_url || null,
            v.discount_type || 'percent', 
            v.discount_percent || 0, 
            v.max_discount_amount || null, 
            v.min_purchase || 0, 
            v.usage_limit || 1, 
            v.expired_at || null
        ]);

        const sql = `INSERT INTO vouchers 
            (code, description, image_url, discount_type, discount_percent, max_discount_amount, min_purchase, usage_limit, expired_at) 
            VALUES ?`;

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
 * 5. BULK DELETE VOUCHERS
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
                message: "Beberapa voucher tidak bisa dihapus karena sudah memiliki riwayat penggunaan." 
            });
        }
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 6. BULK UPDATE STATUS
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