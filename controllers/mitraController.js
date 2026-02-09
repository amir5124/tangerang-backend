const db = require('../config/db');

/**
 * DASHBOARD: Mengambil statistik saldo, pendapatan, rating, dan jumlah pekerjaan.
 * Mengatasi Error 1055 dengan agregasi pada balance dan grouping yang tepat.
 */
exports.getMitraDashboard = async (req, res) => {
    const { id } = req.params; // store_id

    try {
        // 1. QUERY STATISTIK (Sama seperti sebelumnya)
        const statsQuery = `
            SELECT 
                s.store_name,
                IFNULL(MAX(w.balance), 0) as balance,
                IFNULL(SUM(CASE WHEN o.status = 'completed' THEN o.total_price ELSE 0 END), 0) as revenue,
                COUNT(CASE WHEN o.status = 'completed' THEN 1 END) as completed_jobs,
                COUNT(CASE WHEN o.status IN ('pending', 'accepted', 'on_the_way', 'working') THEN 1 END) as active_jobs,
                IFNULL(AVG(r.rating), 0) as avg_rating,
                COUNT(DISTINCT r.id) as total_reviews
            FROM stores s
            LEFT JOIN wallets w ON s.user_id = w.user_id
            LEFT JOIN orders o ON s.id = o.store_id
            LEFT JOIN reviews r ON s.id = r.store_id
            WHERE s.id = ?
            GROUP BY s.id
        `;

        // 2. QUERY DETAIL ORDER TERBARU
        // Menggabungkan orders dengan users (customer) dan services
        const recentOrdersQuery = `
            SELECT 
                o.id as order_id,
                o.total_price,
                o.status,
                o.scheduled_date,
                o.scheduled_time,
                u.full_name as customer_name,
                u.phone_number as customer_phone,
                sv.service_name
            FROM orders o
            JOIN users u ON o.customer_id = u.id
            LEFT JOIN services sv ON o.service_id = sv.id
            WHERE o.store_id = ?
            ORDER BY o.order_date DESC
            LIMIT 5
        `;

        const [statsResults] = await db.query(statsQuery, [id]);
        const [ordersResults] = await db.query(recentOrdersQuery, [id]);

        if (statsResults.length === 0) {
            return res.status(404).json({ success: false, message: "Mitra tidak ditemukan" });
        }

        const stats = statsResults[0];

        res.json({
            success: true,
            data: {
                store_name: stats.store_name,
                stats: {
                    balance: parseFloat(stats.balance),
                    revenue: parseFloat(stats.revenue),
                    completed_jobs: stats.completed_jobs,
                    active_jobs: stats.active_jobs,
                    rating: parseFloat(stats.avg_rating).toFixed(1),
                    total_reviews: stats.total_reviews
                },
                recent_orders: ordersResults // Daftar pesanan detail
            }
        });

    } catch (err) {
        console.error("❌ [Dashboard Error]:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * PROFILE: Mengambil data profil lengkap mitra untuk form edit
 */
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

/**
 * UPDATE: Memperbarui profil toko (termasuk upload logo)
 */
exports.updateStoreProfile = async (req, res) => {
    const { id } = req.params;
    const {
        store_name, identity_number, category, address,
        latitude, longitude, bank_name, bank_account_number,
        operating_hours, description
    } = req.body;

    try {
        const [existing] = await db.query("SELECT store_logo_url FROM stores WHERE id = ?", [id]);
        if (existing.length === 0) return res.status(404).json({ message: "Mitra tidak ditemukan" });

        let finalLogoUrl = existing[0].store_logo_url;
        if (req.file) {
            finalLogoUrl = `/uploads/${req.file.filename}`;
        }

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

        res.json({ success: true, message: "Profil berhasil diperbarui", logo_url: finalLogoUrl });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * PUBLIC: Mengambil semua mitra (bisa filter berdasarkan kategori)
 */
exports.getAllMitra = async (req, res) => {
    const { category } = req.query;
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

/**
 * DETAIL: Mengambil detail satu toko beserta daftar layanannya
 */
exports.getMitraDetail = async (req, res) => {
    const storeId = req.params.id;
    try {
        const [store] = await db.query("SELECT * FROM stores WHERE id = ?", [storeId]);
        const [services] = await db.query("SELECT * FROM services WHERE store_id = ?", [storeId]);
        if (store.length === 0) return res.status(404).json({ message: "Mitra tidak ditemukan" });
        res.json({ ...store[0], services });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * ADMIN: Update & Delete Mitra
 */
exports.updateMitra = async (req, res) => {
    const { store_name, description, address, is_active } = req.body;
    try {
        await db.query(
            "UPDATE stores SET store_name=?, description=?, address=?, is_active=? WHERE id=?",
            [store_name, description, address, is_active, req.params.id]
        );
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