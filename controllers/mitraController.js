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
        // 1. Cek apakah mitra ada
        const [existing] = await db.query("SELECT store_logo_url FROM stores WHERE id = ?", [id]);
        if (existing.length === 0) return res.status(404).json({ message: "Mitra tidak ditemukan" });

        // 2. Tentukan logo_url
        let finalLogoUrl = existing[0].store_logo_url;
        if (req.file) {
            finalLogoUrl = `/uploads/${req.file.filename}`;
        }

        /**
         * 3. Eksekusi Update
         * PERUBAHAN: Menghapus 'approval_status = pending' dan 'is_active = 0'
         * agar toko tetap dalam status terakhirnya (misal: Approved) dan tetap aktif.
         */
        const query = `
            UPDATE stores SET 
                store_name=?, identity_number=?, category=?, address=?, 
                latitude=?, longitude=?, bank_name=?, bank_account_number=?, 
                operating_hours=?, description=?, store_logo_url=?
            WHERE id=?
        `;

        await db.query(query, [
            store_name, identity_number, category, address,
            latitude, longitude, bank_name, bank_account_number,
            operating_hours, description, finalLogoUrl, id
        ]);

        res.json({
            success: true,
            message: "Profil toko berhasil diperbarui.",
            logo_url: finalLogoUrl
        });

    } catch (err) {
        console.error("❌ [Update Error]:", err.message);
        res.status(500).json({
            success: false,
            message: "Gagal memperbarui profil toko",
            error: err.message
        });
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

// --- NEW DASHBOARD FUNCTION ---

exports.getMitraDashboard = async (req, res) => {
    const { id } = req.params; // Ini adalah store_id

    try {
        // 1. Ambil data toko & User ID
        const [store] = await db.query("SELECT user_id, store_name FROM stores WHERE id = ?", [id]);
        if (store.length === 0) return res.status(404).json({ message: "Mitra tidak ditemukan" });

        const userId = store[0].user_id;

        // 2. Ambil Saldo Wallet
        const [wallet] = await db.query("SELECT balance FROM wallets WHERE user_id = ?", [userId]);
        const balance = wallet.length > 0 ? wallet[0].balance : 0;

        // 3. Hitung Statistik Order (Pendapatan & Total Selesai)
        const [orderStats] = await db.query(`
            SELECT 
                SUM(CASE WHEN status = 'completed' THEN total_price ELSE 0 END) as total_revenue,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_jobs,
                SUM(CASE WHEN status = 'pending' OR status = 'accepted' OR status = 'working' THEN 1 ELSE 0 END) as active_jobs
            FROM orders 
            WHERE store_id = ?`, [id]);

        // 4. Hitung Rata-rata Rating & Total Review
        const [reviewStats] = await db.query(`
            SELECT 
                AVG(rating) as avg_rating, 
                COUNT(id) as total_reviews 
            FROM reviews 
            WHERE store_id = ?`, [id]);

        // 5. Ambil 5 Ulasan Terbaru (Opsional untuk Dashboard)
        const [recentReviews] = await db.query(`
            SELECT r.*, u.full_name as customer_name 
            FROM reviews r
            JOIN users u ON r.customer_id = u.id
            WHERE r.store_id = ?
            ORDER BY r.created_at DESC
            LIMIT 5`, [id]);

        // Kirim response gabungan
        res.json({
            success: true,
            data: {
                store_name: store[0].store_name,
                stats: {
                    balance: parseFloat(balance || 0),
                    revenue: parseFloat(orderStats[0].total_revenue || 0),
                    completed_jobs: orderStats[0].completed_jobs,
                    active_jobs: orderStats[0].active_jobs,
                    rating: parseFloat(reviewStats[0].avg_rating || 0).toFixed(1),
                    total_reviews: reviewStats[0].total_reviews
                },
                recent_reviews: recentReviews
            }
        });

    } catch (err) {
        console.error("❌ [Dashboard Data Error]:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};