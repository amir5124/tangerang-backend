const db = require("../config/db"); // Pastikan path ke koneksi DB kamu benar

// Ambil Nilai Setting berdasarkan key_name
exports.getSettingByKey = async (req, res) => {
    const { key } = req.params;
    try {
        const [rows] = await db.execute(
            "SELECT key_value FROM settings WHERE key_name = ?", 
            [key]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Setting tidak ditemukan" });
        }

        res.json({ success: true, value: rows[0].key_value });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update Nilai Setting
exports.updateSetting = async (req, res) => {
    const { key_name, key_value } = req.body;

    if (!key_name || key_value === undefined) {
        return res.status(400).json({ success: false, message: "Data tidak lengkap" });
    }

    try {
        const [result] = await db.execute(
            "UPDATE settings SET key_value = ? WHERE key_name = ?",
            [key_value, key_name]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "Key tidak ditemukan" });
        }

        res.json({ success: true, message: `Setting ${key_name} berhasil diperbarui` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};