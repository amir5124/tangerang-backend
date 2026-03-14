const db = require('../config/db');
const fs = require('fs');
const path = require('path');

exports.uploadAndUpdateAsset = async (req, res) => {
    // LOGGING 1: Periksa header untuk memastikan tipe konten dikirim benar
    console.log("--- DEBUG START ---");
    console.log("Content-Type:", req.headers['content-type']);
    
    // LOGGING 2: Periksa isi body (key_name dsb)
    console.log("Body:", req.body);
    
    // LOGGING 3: Periksa apakah file terdeteksi oleh multer
    console.log("File:", req.file);

    if (!req.file) {
        console.log("ERROR: Multer tidak mendeteksi file!");
        return res.status(400).json({ 
            error: "Tidak ada file diunggah",
            debug: "Multer field name mungkin tidak cocok dengan frontend"
        });
    }
    
    const { key_name, redirect_link } = req.body;
    const image_url = `/uploads/services/${req.file.filename}`; 

    try {
        console.log("Mencari aset lama untuk:", key_name);
        const [existing] = await db.query("SELECT image_url FROM app_assets WHERE key_name = ?", [key_name]);
        
        if (existing.length > 0 && existing[0].image_url) {
            console.log("Menghapus aset lama:", existing[0].image_url);
            // Sesuaikan path join agar benar-benar menuju root project
            const oldPath = path.join(__dirname, '../', existing[0].image_url);
            
            if (fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
            }
        }

        console.log("Update database dengan:", image_url);
        await db.query(
            "INSERT INTO app_assets (key_name, image_url, redirect_link) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE image_url = ?, redirect_link = ?",
            [key_name, image_url, redirect_link || '', image_url, redirect_link || '']
        );
        
        console.log("--- DEBUG SUCCESS ---");
        res.status(200).json({ success: true, image_url });
    } catch (error) {
        console.error("DATABASE ERROR:", error);
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