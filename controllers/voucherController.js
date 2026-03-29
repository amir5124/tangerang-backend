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