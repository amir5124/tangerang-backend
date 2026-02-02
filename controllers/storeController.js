// controllers/storeController.js
const db = require('../config/db');

exports.updateStoreProfile = async (req, res) => {
    const { id } = req.params; // Ini adalah store_id
    const {
        identity_number,
        store_name,
        category,
        address,
        latitude,
        longitude,
        bank_name,
        bank_account_number
    } = req.body;

    try {
        const query = `
            UPDATE stores SET 
                identity_number = ?, 
                store_name = ?, 
                category = ?, 
                address = ?, 
                latitude = ?, 
                longitude = ?, 
                bank_name = ?, 
                bank_account_number = ?,
                approval_status = 'pending' 
            WHERE id = ?
        `;

        await db.query(query, [
            identity_number, store_name, category, address,
            latitude, longitude, bank_name, bank_account_number, id
        ]);

        res.json({ message: "Profil berhasil dikirim, menunggu verifikasi admin." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.completeMitraProfile = async (req, res) => {
    const { store_id, identity_number, category, address, latitude, longitude } = req.body;

    try {
        const query = `
            UPDATE stores SET 
                identity_number = ?, 
                category = ?, 
                address = ?, 
                latitude = ?, 
                longitude = ?, 
                approval_status = 'pending' 
            WHERE id = ?`;

        await db.query(query, [identity_number, category, address, latitude, longitude, store_id]);

        res.json({ message: "Profil berhasil dilengkapi. Silakan tunggu verifikasi admin." });
    } catch (err) {
        res.status(500).json({ error: "Gagal update profil: " + err.message });
    }
};