const db = require('../config/db');
const fs = require('fs');
const path = require('path');

exports.uploadAndUpdateAsset = async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Tidak ada file diunggah" });

    const { key_name, redirect_link } = req.body;
    const filename = `asset-${Date.now()}.jpg`;
    const uploadDir = path.resolve(__dirname, '../uploads/services');
    const filePath = path.join(uploadDir, filename);

    try {
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        
        // Tulis file biner dari buffer
        fs.writeFileSync(filePath, req.file.buffer);

        const image_url = `/uploads/services/${filename}`;
        
        // Database logic
        const [existing] = await db.query("SELECT image_url FROM app_assets WHERE key_name = ?", [key_name]);
        if (existing.length > 0 && existing[0].image_url) {
            const oldPath = path.join(__dirname, '../', existing[0].image_url);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        await db.query(
            "INSERT INTO app_assets (key_name, image_url, redirect_link) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE image_url = ?, redirect_link = ?",
            [key_name, image_url, redirect_link || '', image_url, redirect_link || '']
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