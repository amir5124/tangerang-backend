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
        description,      // <--- Tambahkan ini
        store_logo_url    // <--- Tambahkan ini
    } = req.body;

    try {
        const [existing] = await db.query('SELECT id FROM stores WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ message: "Data toko tidak ditemukan." });
        }

        // Update Query dengan tambahan description dan store_logo_url
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
                operating_hours = ?,
                approval_status = 'pending',
                is_active = 0
            WHERE id = ?
        `;

        await db.query(query, [
            identity_number,
            store_name,
            category,
            description,      // Bind value deskripsi
            store_logo_url,    // Bind value logo
            address,
            latitude,
            longitude,
            bank_name,
            bank_account_number,
            operating_hours,
            id
        ]);

        res.json({
            message: "Profil berhasil dikirim, menunggu verifikasi admin.",
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

// Fungsi ini bisa tetap ada sebagai alias atau dihapus jika route sudah diarahkan ke updateStoreProfile
exports.completeMitraProfile = async (req, res) => {
    // Memanggil fungsi di atas agar logika tetap satu pintu
    return exports.updateStoreProfile(req, res);
};