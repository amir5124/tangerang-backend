const db = require('../config/db');

// Controller untuk mengambil semua data pengguna (khusus Admin)
exports.getAllUsers = async (req, res) => {
    try {
        // Query untuk mengambil semua user. 
        // Menggunakan LEFT JOIN agar user dengan role 'customer' tetap muncul 
        // meskipun tidak punya data di tabel stores.
        const sql = `
            SELECT 
                u.id, 
                u.full_name, 
                u.email, 
                u.phone_number, 
                u.role, 
                u.fcm_token,
                u.created_at,
                s.store_name,
                s.approval_status AS store_status,
                s.category AS store_category
            FROM users u
            LEFT JOIN stores s ON u.id = s.user_id
            ORDER BY u.created_at DESC
        `;

        console.log("DEBUG: Admin fetching all users list...");
        
        // Menggunakan db.execute (lebih aman dan konsisten dengan controller order Anda)
        const [rows] = await db.execute(sql);

        res.status(200).json({
            success: true,
            message: "Data semua pengguna berhasil diambil",
            count: rows.length,
            data: rows
        });
    } catch (error) {
        console.error("❌ Get All Users Error:", error.message);
        res.status(500).json({
            success: false,
            message: "Gagal mengambil data pengguna",
            error: error.message
        });
    }
};