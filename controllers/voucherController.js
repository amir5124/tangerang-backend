const db = require('../config/db'); // Sesuaikan path ke koneksi database kamu

exports.validateVoucher = async (req, res) => {
    // Kita gunakan user_id (merujuk ke users.id)
    const { code, user_id, subtotal_layanan } = req.body;

    if (!code || !user_id) {
        return res.status(400).json({ 
            success: false, 
            message: "Data tidak lengkap (kode atau user_id kosong)." 
        });
    }

    try {
        // 1. Cari voucher yang aktif
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

        // 2. Cek apakah user (id) ini sudah pernah pakai voucher ini
        const [usageCheck] = await db.execute(
            "SELECT id FROM voucher_usages WHERE voucher_id = ? AND user_id = ?",
            [v.id, user_id]
        );

        if (usageCheck.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Voucher ini sudah pernah Anda gunakan sebelumnya." 
            });
        }

        // 3. Cek Minimal Belanja (Opsional tapi disarankan)
        if (v.min_purchase && subtotal_layanan < v.min_purchase) {
            return res.status(400).json({
                success: false,
                message: `Minimal belanja untuk voucher ini adalah Rp${parseInt(v.min_purchase).toLocaleString('id-ID')}`
            });
        }

        // 4. Hitung besaran diskon
        let discountAmount = 0;
        if (v.discount_type === 'percent') {
            discountAmount = Math.floor(subtotal_layanan * (v.discount_percent / 100));
            // Batasi jika ada maksimal diskon
            if (v.max_discount_amount && discountAmount > v.max_discount_amount) {
                discountAmount = parseFloat(v.max_discount_amount);
            }
        } else {
            // Jika tipe diskon adalah nominal tetap (fixed)
            discountAmount = parseFloat(v.discount_fixed_amount || 0);
        }

        res.status(200).json({
            success: true,
            message: "Voucher berhasil diterapkan!",
            data: {
                voucher_id: v.id,
                code: v.code,
                discount_amount: discountAmount
            }
        });

    } catch (error) {
        console.error("❌ Error Validasi Voucher:", error.message);
        res.status(500).json({ 
            success: false, 
            message: "Terjadi kesalahan server saat validasi voucher", 
            error: error.message 
        });
    }
};

// Get all vouchers
exports.getVouchers = async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT * FROM vouchers ORDER BY created_at DESC");
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Update voucher status or data
// controllers/voucherController.js
exports.updateVoucher = async (req, res) => {
    const { id } = req.params;
    const { is_active, expired_at, min_purchase, code, max_discount_amount } = req.body;

    try {
        // Ambil data yang ada saat ini
        const [rows] = await db.execute("SELECT * FROM vouchers WHERE id = ?", [id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: "Voucher tidak ditemukan" });
        
        const oldData = rows[0];

        // Gabungkan data lama dengan data baru (jika baru undefined, pakai yang lama)
        const updateData = {
            code: code !== undefined ? code : oldData.code,
            is_active: is_active !== undefined ? is_active : oldData.is_active,
            expired_at: expired_at !== undefined ? expired_at : oldData.expired_at,
            min_purchase: min_purchase !== undefined ? min_purchase : oldData.min_purchase,
            max_discount_amount: max_discount_amount !== undefined ? max_discount_amount : oldData.max_discount_amount
        };

        await db.execute(
            "UPDATE vouchers SET code = ?, is_active = ?, expired_at = ?, min_purchase = ?, max_discount_amount = ? WHERE id = ?",
            [updateData.code, updateData.is_active, updateData.expired_at, updateData.min_purchase, updateData.max_discount_amount, id]
        );

        res.status(200).json({ success: true, message: "Voucher berhasil diperbarui" });
    } catch (error) {
        console.error("Update Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};