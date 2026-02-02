const db = require('../config/db');

// --- EXISTING FUNCTIONS ---

// controllers/mitraController.js
exports.getAllMitra = async (req, res) => {
    const { category } = req.query; // Menangkap ?category=ac

    let query = `
        SELECT s.*, GROUP_CONCAT(sv.service_name SEPARATOR ', ') as services
        FROM stores s
        LEFT JOIN services sv ON s.id = sv.store_id
        WHERE s.is_active = 1
    `;

    const params = [];

    if (category) {
        query += ` AND s.category = ?`;
        params.push(category);
    }

    query += ` GROUP BY s.id`;

    try {
        const [results] = await db.query(query, params);
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getMitraDetail = async (req, res) => {
    const storeId = req.params.id;
    const storeQuery = "SELECT * FROM stores WHERE id = ?";
    const serviceQuery = "SELECT * FROM services WHERE store_id = ?";
    try {
        const [store] = await db.query(storeQuery, [storeId]);
        const [services] = await db.query(serviceQuery, [storeId]);
        if (store.length === 0) return res.status(404).json({ message: "Mitra tidak ditemukan" });
        res.json({ ...store[0], services });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- NEW FUNCTIONS (UNTUK COMPLETE/EDIT PROFILE) ---

// 1. Fungsi Ambil Profil untuk Form Edit (MENGATASI 404)
exports.getStoreProfile = async (req, res) => {
    const { id } = req.params;
    try {
        const [results] = await db.query("SELECT * FROM stores WHERE id = ?", [id]);
        if (results.length === 0) return res.status(404).json({ message: "Toko tidak ditemukan" });
        res.json(results[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 2. Fungsi Update Profil Lengkap (Dipanggil oleh form React Native)
exports.updateStoreProfile = async (req, res) => {
    const { id } = req.params;

    const {
        store_name, identity_number, category, address,
        latitude, longitude, bank_name, bank_account_number,
        operating_hours, description
    } = req.body;

    try {
        // 1. Ambil data lama untuk pengecekan
        const [existing] = await db.query(
            "SELECT store_logo_url, approval_status, is_active FROM stores WHERE id = ?",
            [id]
        );

        if (existing.length === 0) {
            return res.status(404).json({ message: "Mitra tidak ditemukan" });
        }

        // 2. Logika Logo: Gunakan file baru jika ada, jika tidak gunakan yang lama
        let finalLogoUrl = existing[0].store_logo_url;
        if (req.file) {
            finalLogoUrl = `/uploads/${req.file.filename}`;
        }

        /* 3. LOGIKA PERSISTENT STATUS:
           - Jika status saat ini sudah 'approved', biarkan tetap 'approved'.
           - Jika statusnya masih 'rejected' atau kosong, barulah set ke 'pending'.
           - Atau jika Anda ingin tetap auto-pending setiap edit, gunakan kode lama Anda.
        */
        const newStatus = existing[0].approval_status === 'approved' ? 'approved' : 'pending';
        const newActive = existing[0].approval_status === 'approved' ? 1 : 0;

        const query = `
            UPDATE stores SET 
                store_name=?, 
                identity_number=?, 
                category=?, 
                address=?, 
                latitude=?, 
                longitude=?, 
                bank_name=?, 
                bank_account_number=?, 
                operating_hours=?, 
                description=?, 
                store_logo_url=?,
                approval_status = ?,
                is_active = ?
            WHERE id=?
        `;

        await db.query(query, [
            store_name,
            identity_number,
            category,
            address,
            latitude,
            longitude,
            bank_name,
            bank_account_number,
            operating_hours,
            description,
            finalLogoUrl,
            newStatus, // Dinamis: tidak langsung dipaksa pending
            newActive, // Dinamis: tidak langsung dipaksa non-aktif
            id
        ]);

        res.json({
            success: true,
            message: newStatus === 'approved' ? "Profil berhasil diperbarui." : "Profil diperbarui, menunggu verifikasi admin.",
            logo_url: finalLogoUrl,
            status: newStatus
        });

    } catch (err) {
        console.error("❌ [Update Error]:", err.message);
        res.status(500).json({ error: err.message });
    }
};

// --- ADMIN FUNCTIONS ---

exports.updateMitra = async (req, res) => {
    const { store_name, description, address, is_active } = req.body;
    const query = "UPDATE stores SET store_name=?, description=?, address=?, is_active=? WHERE id=?";
    try {
        await db.query(query, [store_name, description, address, is_active, req.params.id]);
        res.json({ message: "Status mitra diperbarui" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.deleteMitra = async (req, res) => {
    try {
        await db.query("DELETE FROM stores WHERE id = ?", [req.params.id]);
        res.json({ message: "Mitra berhasil dihapus" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};