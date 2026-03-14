const db = require('../config/db');
const fs = require('fs');
const path = require('path');

exports.uploadAndUpdateAssetBase64 = async (req, res) => {
    const { key_name, image_data, file_name } = req.body;
    
    if (!image_data) return res.status(400).json({ error: "Data gambar tidak ditemukan" });

    const filename = `asset-${Date.now()}.jpg`;
    const uploadDir = path.resolve(__dirname, '../uploads/services');
    const filePath = path.join(uploadDir, filename);

    try {
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        
        // Simpan Base64 menjadi file biner
        fs.writeFileSync(filePath, Buffer.from(image_data, 'base64'));

        const image_url = `/uploads/services/${filename}`;
        
        // Database update (sama seperti kode Anda sebelumnya)
        await db.query(
            "INSERT INTO app_assets (key_name, image_url) VALUES (?, ?) ON DUPLICATE KEY UPDATE image_url = ?",
            [key_name, image_url, image_url]
        );

        res.status(200).json({ success: true, image_url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getAssets = async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM app_assets");
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};