const db = require('../config/db'); // Asumsi Anda punya koneksi db

// 1. Ambil semua Mitra beserta Layanan mereka
exports.getAllMitra = (req, res) => {
    const query = `
        SELECT s.*, GROUP_CONCAT(sv.service_name SEPARATOR ', ') as services
        FROM stores s
        LEFT JOIN services sv ON s.id = sv.store_id
        WHERE s.is_active = 1
        GROUP BY s.id
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

// 2. Ambil Detail satu Mitra dan Daftar Jasa Lengkap
exports.getMitraDetail = (req, res) => {
    const storeId = req.params.id;
    const storeQuery = "SELECT * FROM stores WHERE id = ?";
    const serviceQuery = "SELECT * FROM services WHERE store_id = ?";

    db.query(storeQuery, [storeId], (err, store) => {
        if (err) return res.status(500).json({ error: err.message });

        db.query(serviceQuery, [storeId], (err, services) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ ...store[0], services });
        });
    });
};

// 3. Update Profil Mitra
exports.updateMitra = (req, res) => {
    const { store_name, description, address, is_active } = req.body;
    const query = "UPDATE stores SET store_name=?, description=?, address=?, is_active=? WHERE id=?";

    db.query(query, [store_name, description, address, is_active, req.params.id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Profil mitra berhasil diperbarui" });
    });
};

// 4. Hapus Mitra (Soft Delete atau Hard Delete)
exports.deleteMitra = (req, res) => {
    // Sebaiknya is_active diubah ke 0 saja agar data order lama tidak hilang (Soft Delete)
    const query = "DELETE FROM stores WHERE id = ?";
    db.query(query, [req.params.id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Mitra berhasil dihapus" });
    });
};