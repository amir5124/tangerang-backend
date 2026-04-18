const db = require('../config/db');
const fs = require('fs');
const path = require('path');

// 1. Ambil Semua Asset
exports.getAssets = async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM app_assets ORDER BY id DESC");
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 2. Tambah Asset Baru
exports.createAsset = async (req, res) => {
    const { key_name, display_name } = req.body;
    if (!key_name || !display_name) {
        return res.status(400).json({ error: "Key name dan Display name wajib diisi" });
    }

    try {
        const [existing] = await db.query("SELECT id FROM app_assets WHERE key_name = ?", [key_name]);
        if (existing.length > 0) {
            return res.status(400).json({ error: "Key name sudah digunakan" });
        }

        const [result] = await db.query(
            "INSERT INTO app_assets (key_name, display_name, image_url) VALUES (?, ?, ?)",
            [key_name, display_name, '']
        );

        res.status(201).json({ success: true, message: "Asset berhasil ditambahkan", id: result.insertId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 3. Upload Gambar Base64 (Update Ikon)
exports.uploadAndUpdateAssetBase64 = async (req, res) => {
    const { key_name, image_data } = req.body;
    if (!image_data) return res.status(400).json({ error: "Data gambar tidak ditemukan" });

    const filename = `asset-${Date.now()}.jpg`;
    const uploadDir = path.resolve(__dirname, '../uploads/services');
    const filePath = path.join(uploadDir, filename);

    try {
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(filePath, Buffer.from(image_data, 'base64'));

        const image_url = `/uploads/services/${filename}`;
        
        await db.query(
            "INSERT INTO app_assets (key_name, image_url) VALUES (?, ?) ON DUPLICATE KEY UPDATE image_url = ?",
            [key_name, image_url, image_url]
        );

        res.status(200).json({ success: true, image_url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 4. Update Nama Layanan
exports.updateAssetInfo = async (req, res) => {
    const { id } = req.params;
    const { display_name } = req.body;

    if (!display_name) return res.status(400).json({ error: "Nama tidak boleh kosong" });

    try {
        const [result] = await db.query("UPDATE app_assets SET display_name = ? WHERE id = ?", [display_name, id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: "Asset tidak ditemukan" });

        res.status(200).json({ success: true, message: "Nama diperbarui" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 5. Hapus Asset (Fungsi Baru)
exports.deleteAsset = async (req, res) => {
    const { id } = req.params;

    try {
        // Ambil data asset dulu untuk tahu path gambarnya
        const [rows] = await db.query("SELECT image_url FROM app_assets WHERE id = ?", [id]);
        if (rows.length === 0) return res.status(404).json({ error: "Asset tidak ditemukan" });

        const imageUrl = rows[0].image_url;

        // Hapus file fisik jika ada
        if (imageUrl) {
            const fullPath = path.resolve(__dirname, '..', imageUrl.startsWith('/') ? imageUrl.substring(1) : imageUrl);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
        }

        // Hapus dari database
        await db.query("DELETE FROM app_assets WHERE id = ?", [id]);

        res.status(200).json({ success: true, message: "Asset berhasil dihapus" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};