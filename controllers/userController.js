const db = require('../config/db');

exports.getAllUsers = async (req, res) => {
    try {
        const sql = `
            SELECT 
                u.id, 
                u.full_name, 
                u.email, 
                u.phone_number, 
                u.role, 
                u.fcm_token,
                u.created_at,
                s.id AS store_id,
                s.store_name,
                s.approval_status AS store_status,
                s.category AS store_category
            FROM users u
            LEFT JOIN stores s ON u.id = s.user_id
            ORDER BY u.created_at DESC
        `;

        console.log("DEBUG: Admin fetching all users list...");

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