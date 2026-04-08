const db = require('../config/db');

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

        // CATATAN: Jangan INSERT ke voucher_usages di sini jika validateVoucher 
        // dipanggil hanya untuk pengecekan di halaman checkout (preview).
        // Insert idealnya dilakukan saat 'Confirm Order' berhasil.

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