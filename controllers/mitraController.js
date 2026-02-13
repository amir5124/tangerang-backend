const db = require('../config/db');

/**
 * DASHBOARD: Mengambil statistik saldo, pendapatan, rating, dan jumlah pekerjaan.
 * Mengatasi Error 1055 dengan agregasi pada balance dan grouping yang tepat.
 */
exports.getMitraDashboard = async (req, res) => {
    const { id } = req.params; // store_id

    try {
        console.log(`\n[DEBUG] Fetching Dashboard for Store ID: ${id}`);

        // 1. QUERY STATISTIK (DIPERBAIKI & LENGKAP)
        const statsQuery = `
        SELECT 
            s.store_name,
            s.user_id,
            -- Saldo nyata di dompet (Uang Cair)
            IFNULL((SELECT balance FROM wallets WHERE user_id = s.user_id LIMIT 1), 0) as balance,
            
            -- Total Pendapatan yang SUDAH CAIR (70% dari order completed)
            IFNULL((SELECT SUM(FLOOR(total_price * 0.7)) FROM orders WHERE store_id = s.id AND status = 'completed'), 0) as revenue,
            
            -- Pekerjaan Selesai (Hanya yang sudah dikonfirmasi Customer)
            (SELECT COUNT(*) FROM orders WHERE store_id = s.id AND status = 'completed') as completed_jobs,
            
            -- PEKERJAAN AKTIF (Sudah bayar & perlu tindakan: Pending, Accepted, OTW, Working)
            (SELECT COUNT(*) FROM orders WHERE store_id = s.id AND status IN ('pending', 'accepted', 'on_the_way', 'working')) as active_jobs,
    
            -- PEKERJAAN MENUNGGU KONFIRMASI (Sudah diupload bukti tapi belum completed)
            (SELECT COUNT(*) FROM orders WHERE store_id = s.id AND status = 'working' AND proof_image_url IS NOT NULL) as pending_confirmation,
            
            IFNULL((SELECT AVG(rating) FROM reviews WHERE store_id = s.id), 0) as avg_rating,
            (SELECT COUNT(*) FROM reviews WHERE store_id = s.id) as total_reviews
        FROM stores s
        WHERE s.id = ?
    `;

        // 2. QUERY DETAIL ORDER TERBARU (DENGAN PROOF_IMAGE_URL)
        const recentOrdersQuery = `
            SELECT 
                o.id, 
                o.total_price,
                o.status,
                o.proof_image_url, -- PENTING: Agar UI Mitra bisa deteksi status "Menunggu Konfirmasi"
                o.scheduled_date,
                o.scheduled_time,
                u.full_name as customer_name,
                (SELECT service_name FROM order_items WHERE order_id = o.id LIMIT 1) as service_name
            FROM orders o
            JOIN users u ON o.customer_id = u.id
            WHERE o.store_id = ? 
            AND o.status != 'unpaid'
            ORDER BY o.order_date DESC
            LIMIT 5
        `;

        const [statsResults] = await db.query(statsQuery, [id]);
        const [ordersResults] = await db.query(recentOrdersQuery, [id]);

        if (statsResults.length === 0) {
            return res.status(404).json({ success: false, message: "Mitra tidak ditemukan" });
        }

        const stats = statsResults[0];

        // LOGGING UNTUK CROSS-CHECK
        console.log(`[DEBUG] Dashboard Stats - Balance: ${stats.balance}, Active: ${stats.active_jobs}, Pending Conf: ${stats.pending_confirmation}`);

        res.json({
            success: true,
            data: {
                store_name: stats.store_name,
                stats: {
                    balance: parseFloat(stats.balance),
                    revenue: parseFloat(stats.revenue),
                    completed_jobs: parseInt(stats.completed_jobs),
                    active_jobs: parseInt(stats.active_jobs),
                    pending_confirmation: parseInt(stats.pending_confirmation), // DATA TAMBAHAN
                    rating: parseFloat(stats.avg_rating).toFixed(1),
                    total_reviews: parseInt(stats.total_reviews)
                },
                recent_orders: ordersResults
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