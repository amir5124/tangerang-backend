const db = require('../config/db');
const fs = require('fs');
const path = require('path');

// 1. Ambil Semua Asset (Otomatis menyertakan display_name & category)
exports.getAssets = async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM app_assets ORDER BY id DESC");
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 2. Upload Gambar Base64 (Hanya update gambar, tidak menimpa nama)
exports.uploadAndUpdateAssetBase64 = async (req, res) => {
    const { key_name, image_data } = req.body;
    
    if (!image_data) return res.status(400).json({ error: "Data gambar tidak ditemukan" });

    const filename = `asset-${Date.now()}.jpg`;
    const uploadDir = path.resolve(__dirname, '../uploads/services');
    const filePath = path.join(uploadDir, filename);

    try {
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        
        // Simpan Base64 menjadi file biner
        fs.writeFileSync(filePath, Buffer.from(image_data, 'base64'));

        const image_url = `/uploads/services/${filename}`;
        
        // Menggunakan ON DUPLICATE KEY UPDATE agar jika key_name sudah ada, hanya image_url yang berubah
        await db.query(
            "INSERT INTO app_assets (key_name, image_url) VALUES (?, ?) ON DUPLICATE KEY UPDATE image_url = ?",
            [key_name, image_url, image_url]
        );

        res.status(200).json({ success: true, image_url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 3. Update Nama Layanan / Display Name (Fungsi Baru)
exports.updateAssetInfo = async (req, res) => {
    const { id } = req.params;
    const { display_name } = req.body;

    if (!display_name) {
        return res.status(400).json({ error: "Nama layanan tidak boleh kosong" });
    }

    try {
        const [result] = await db.query(
            "UPDATE app_assets SET display_name = ? WHERE id = ?",
            [display_name, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Asset tidak ditemukan" });
        }

        res.status(200).json({ success: true, message: "Nama layanan berhasil diperbarui" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};