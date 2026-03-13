const db = require('../config/db');

exports.updateAsset = async (req, res) => {
    const { key_name, image_url, redirect_link } = req.body;
    try {
        await db.query(
            "UPDATE app_assets SET image_url = ?, redirect_link = ? WHERE key_name = ?",
            [image_url, redirect_link, key_name]
        );
        res.status(200).json({ success: true, message: "Aset diperbarui" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getAssets = async (req, res) => {
    try {
        const [assets] = await db.query("SELECT * FROM app_assets");
        res.status(200).json(assets);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};