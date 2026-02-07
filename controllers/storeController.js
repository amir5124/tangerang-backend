const db = require('../config/db');

exports.updateStoreProfile = async (req, res) => {
    const { id } = req.params;
    const {
        identity_number,
        store_name,
        category,
        address,
        latitude,
        longitude,
        bank_name,
        bank_account_number,
        operating_hours,
        description,
        store_logo_url
    } = req.body;

    try {
        const [existing] = await db.query('SELECT id, approval_status FROM stores WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ message: "Data toko tidak ditemukan." });
        }

        /**
         * PERUBAHAN DI SINI:
         * Menghapus 'approval_status = pending' dan 'is_active = 0'
         * agar toko tetap bisa berjualan setelah update profil.
         */
        const query = `
            UPDATE stores SET 
                identity_number = ?, 
                store_name = ?, 
                category = ?, 
                description = ?, 
                store_logo_url = ?, 
                address = ?, 
                latitude = ?, 
                longitude = ?, 
                bank_name = ?, 
                bank_account_number = ?,
                operating_hours = ?
            WHERE id = ?
        `;

        await db.query(query, [
            identity_number,
            store_name,
            category,
            description,
            store_logo_url,
            address,
            latitude,
            longitude,
            bank_name,
            bank_account_number,
            operating_hours,
            id
        ]);

        res.json({
            message: "Profil toko berhasil diperbarui.",
            success: true
        });

    } catch (err) {
        console.error("❌ [Backend Error]:", err.message);
        res.status(500).json({
            message: "Gagal memperbarui profil toko",
            error: err.message
        });
    }
};

exports.completeMitraProfile = async (req, res) => {
    return exports.updateStoreProfile(req, res);
};