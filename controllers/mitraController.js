const db = require('../config/db');

// 1. Ambil semua Mitra beserta Layanan mereka
exports.getAllMitra = async (req, res) => {
    console.log(">>> [GET] Request daftar semua mitra masuk...");
    const query = `
        SELECT s.*, GROUP_CONCAT(sv.service_name SEPARATOR ', ') as services
        FROM stores s
        LEFT JOIN services sv ON s.id = sv.store_id
        WHERE s.is_active = 1
        GROUP BY s.id
    `;
    try {
        const [results] = await db.query(query);
        console.log(`>>> [DB Success] Berhasil mengambil ${results.length} mitra.`);

        // Log sampel data pertama untuk cek struktur
        if (results.length > 0) {
            console.log(">>> [Sample Data]:", results[0]);
        }

        res.json(results);
    } catch (err) {
        console.error(">>> [DB Error] getAllMitra:", err.message);
        res.status(500).json({ error: err.message });
    }
};

// 2. Ambil Detail satu Mitra dan Daftar Jasa Lengkap
exports.getMitraDetail = async (req, res) => {
    const storeId = req.params.id;
    console.log(`>>> [GET] Request detail mitra ID: ${storeId}`);

    const storeQuery = "SELECT * FROM stores WHERE id = ?";
    const serviceQuery = "SELECT * FROM services WHERE store_id = ?";

    try {
        const [store] = await db.query(storeQuery, [storeId]);
        const [services] = await db.query(serviceQuery, [storeId]);

        if (store.length === 0) {
            console.warn(`>>> [Warn] Mitra dengan ID ${storeId} tidak ditemukan.`);
            return res.status(404).json({ message: "Mitra tidak ditemukan" });
        }

        console.log(`>>> [DB Success] Detail mitra ${store[0].store_name} ditemukan dengan ${services.length} layanan.`);
        res.json({ ...store[0], services });
    } catch (err) {
        console.error(`>>> [DB Error] getMitraDetail ID ${storeId}:`, err.message);
        res.status(500).json({ error: err.message });
    }
};

// 3. Update Profil Mitra
exports.updateMitra = async (req, res) => {
    const { store_name } = req.body;
    console.log(`>>> [PUT] Update mitra ID: ${req.params.id} (${store_name})`);

    const { description, address, is_active } = req.body;
    const query = "UPDATE stores SET store_name=?, description=?, address=?, is_active=? WHERE id=?";

    try {
        const [result] = await db.query(query, [store_name, description, address, is_active, req.params.id]);
        console.log(">>> [DB Success] Baris terpengaruh:", result.affectedRows);
        res.json({ message: "Profil mitra berhasil diperbarui" });
    } catch (err) {
        console.error(">>> [DB Error] updateMitra:", err.message);
        res.status(500).json({ error: err.message });
    }
};

// 4. Hapus Mitra
exports.deleteMitra = async (req, res) => {
    console.log(`>>> [DELETE] Request hapus mitra ID: ${req.params.id}`);
    const query = "DELETE FROM stores WHERE id = ?";
    try {
        const [result] = await db.query(query, [req.params.id]);
        console.log(">>> [DB Success] Baris dihapus:", result.affectedRows);
        res.json({ message: "Mitra berhasil dihapus" });
    } catch (err) {
        console.error(">>> [DB Error] deleteMitra:", err.message);
        res.status(500).json({ error: err.message });
    }
};