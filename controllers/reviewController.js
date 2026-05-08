const db = require('../config/db'); // Asumsi koneksi database Anda

const getReviewSummary = async (req, res) => {
    const { store_id } = req.params;

    try {
        // 1. Ambil Ringkasan Skor (Sesuai kolom tabel reviews Anda)
        const [summary] = await db.execute(`
            SELECT 
                COUNT(*) as total_reviews,
                ROUND(AVG(rating), 1) as avg_rating,
                ROUND(AVG(rating_quality), 1) as avg_quality,
                ROUND(AVG(rating_punctuality), 1) as avg_punctuality,
                ROUND(AVG(rating_communication), 1) as avg_communication
            FROM reviews 
            WHERE store_id = ?
        `, [store_id]);

        // 2. Ambil Daftar Komentar Terbaru + Foto Profil + Detail Jasa
        const [comments] = await db.execute(`
            SELECT 
                r.id AS review_id,
                r.rating,
                r.comment,
                r.created_at,
                u.full_name,
                u.profile_picture,
                o.items AS detail_jasa
            FROM reviews r
            JOIN orders o ON r.order_id = o.id
            JOIN users u ON r.customer_id = u.id
            WHERE r.store_id = ?
            ORDER BY r.created_at DESC
            LIMIT 10
        `, [store_id]);

        // Parsing JSON items untuk setiap komentar
        const formattedComments = comments.map(item => ({
            ...item,
            detail_jasa: JSON.parse(item.detail_jasa || '[]')
        }));

        res.status(200).json({
            success: true,
            summary: summary[0],
            latest_comments: formattedComments
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

module.exports = { getReviewSummary };