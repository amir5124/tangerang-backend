const db = require('../config/db');
const fs = require('fs');

exports.uploadAndUpdateAsset = async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Tidak ada file diunggah" });
    
    const { key_name, redirect_link } = req.body;
    const image_url = `/uploads/assets/${req.file.filename}`; 

    try {
      
        const [existing] = await db.query("SELECT image_url FROM app_assets WHERE key_name = ?", [key_name]);
        
       
        if (existing.length > 0 && existing[0].image_url) {
            const oldPath = path.join(__dirname, '../', existing[0].image_url);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        await db.query(
            "INSERT INTO app_assets (key_name, image_url, redirect_link) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE image_url = ?, redirect_link = ?",
            [key_name, image_url, redirect_link, image_url, redirect_link]
        );
        
        res.status(200).json({ success: true, image_url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};