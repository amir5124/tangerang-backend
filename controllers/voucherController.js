const db = require('../config/db');
const path = require('path');
const fs = require('fs-extra');

// Gunakan path relatif yang akan terhubung ke persistent storage Coolify
// Persistent storage sudah terhubung ke /app/uploads
const uploadDir = path.join(__dirname, '../uploads/vouchers');
fs.ensureDirSync(uploadDir);

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
                description: v.description,
                image_url: v.image_url,
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
        const [rows] = await db.execute("SELECT * FROM vouchers ORDER BY created_at DESC");
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 3. UPLOAD GAMBAR VOUCHER (maks 10MB)
 * File akan tersimpan di persistent storage melalui folder uploads/vouchers
 */
exports.uploadVoucherImage = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Tidak ada file yang diupload atau file melebihi 10MB"
            });
        }

        // Dapatkan informasi file
        const imageUrl = `/uploads/vouchers/${req.file.filename}`;

        res.status(200).json({
            success: true,
            message: "Gambar berhasil diupload",
            data: {
                image_url: imageUrl,
                filename: req.file.filename,
                size: req.file.size,
                mimetype: req.file.mimetype
            }
        });
    } catch (error) {
        console.error("❌ Error upload gambar:", error.message);
        res.status(500).json({
            success: false,
            message: "Gagal mengupload gambar",
            error: error.message
        });
    }
};

/**
 * 4. HAPUS GAMBAR VOUCHER
 * Menghapus file dari persistent storage
 */
exports.deleteVoucherImage = async (req, res) => {
    const { id } = req.params;

    try {
        // Ambil image_url dari database
        const [vouchers] = await db.execute(
            "SELECT image_url FROM vouchers WHERE id = ?",
            [id]
        );

        if (vouchers.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Voucher tidak ditemukan"
            });
        }

        const imageUrl = vouchers[0].image_url;

        if (imageUrl) {
            // Hapus file dari sistem (terhubung ke persistent storage)
            const filename = path.basename(imageUrl);
            const filePath = path.join(__dirname, '../uploads/vouchers', filename);

            if (await fs.pathExists(filePath)) {
                await fs.remove(filePath);
            }

            // Update database: hapus image_url
            await db.execute(
                "UPDATE vouchers SET image_url = NULL WHERE id = ?",
                [id]
            );
        }

        res.status(200).json({
            success: true,
            message: "Gambar berhasil dihapus"
        });
    } catch (error) {
        console.error("❌ Error hapus gambar:", error.message);
        res.status(500).json({
            success: false,
            message: "Gagal menghapus gambar",
            error: error.message
        });
    }
};

/**
 * 5. UPDATE VOUCHER (SINGLE) - Dengan dukungan upload gambar
 */
exports.updateVoucher = async (req, res) => {
    const { id } = req.params;
    const {
        is_active, expired_at, min_purchase, code,
        max_discount_amount, usage_limit, description,
        image_url, discount_percent
    } = req.body;

    try {
        const [rows] = await db.execute("SELECT * FROM vouchers WHERE id = ?", [id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: "Voucher tidak ditemukan" });

        const oldData = rows[0];

        // Proses image_url: prioritaskan dari body dulu, lalu dari file upload
        let finalImageUrl = image_url !== undefined ? image_url : oldData.image_url;

        // Jika ada file yang diupload melalui multer
        if (req.file) {
            // Hapus gambar lama jika ada
            if (oldData.image_url && oldData.image_url !== finalImageUrl) {
                const oldFilename = path.basename(oldData.image_url);
                const oldFilePath = path.join(__dirname, '../uploads/vouchers', oldFilename);
                if (await fs.pathExists(oldFilePath)) {
                    await fs.remove(oldFilePath);
                }
            }

            // Set image_url baru dari file upload
            finalImageUrl = `/uploads/vouchers/${req.file.filename}`;
        }

        const updateData = {
            code: code !== undefined ? code : oldData.code,
            description: description !== undefined ? description : oldData.description,
            image_url: finalImageUrl,
            discount_percent: discount_percent !== undefined ? discount_percent : oldData.discount_percent,
            is_active: is_active !== undefined ? is_active : oldData.is_active,
            usage_limit: usage_limit !== undefined ? usage_limit : oldData.usage_limit,
            expired_at: expired_at !== undefined ? expired_at : oldData.expired_at,
            min_purchase: min_purchase !== undefined ? min_purchase : oldData.min_purchase,
            max_discount_amount: max_discount_amount !== undefined ? max_discount_amount : oldData.max_discount_amount
        };

        await db.execute(
            `UPDATE vouchers SET 
                code = ?, description = ?, image_url = ?, discount_percent = ?,
                is_active = ?, usage_limit = ?, expired_at = ?, 
                min_purchase = ?, max_discount_amount = ? 
            WHERE id = ?`,
            [
                updateData.code, updateData.description, updateData.image_url,
                updateData.discount_percent,
                updateData.is_active, updateData.usage_limit, updateData.expired_at,
                updateData.min_purchase, updateData.max_discount_amount, id
            ]
        );

        res.status(200).json({
            success: true,
            message: "Voucher berhasil diperbarui",
            data: { image_url: finalImageUrl }
        });
    } catch (error) {
        console.error("Error update voucher:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 6. BULK CREATE VOUCHERS
 */
exports.bulkCreateVouchers = async (req, res) => {
    const { vouchers } = req.body;

    if (!Array.isArray(vouchers) || vouchers.length === 0) {
        return res.status(400).json({ success: false, message: "Data voucher harus berupa array." });
    }

    try {
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
 * 7. BULK DELETE VOUCHERS
 * Menghapus voucher beserta file gambarnya dari persistent storage
 */
exports.bulkDeleteVouchers = async (req, res) => {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: "Pilih voucher yang ingin dihapus (array ID)." });
    }

    try {
        // Ambil semua image_url sebelum delete
        const [vouchersToDelete] = await db.execute(
            `SELECT image_url FROM vouchers WHERE id IN (${ids.map(() => '?').join(',')})`,
            ids
        );

        // Hapus file-file gambar
        for (const voucher of vouchersToDelete) {
            if (voucher.image_url) {
                const filename = path.basename(voucher.image_url);
                const filePath = path.join(__dirname, '../uploads/vouchers', filename);
                if (await fs.pathExists(filePath)) {
                    await fs.remove(filePath);
                }
            }
        }

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
 * 8. BULK UPDATE STATUS
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