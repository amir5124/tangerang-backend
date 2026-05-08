const db = require('../config/db');

// ─── GET REVIEW SUMMARY ─────────────────────────────────────────────────────
const getReviewSummary = async (req, res) => {
    const { store_id } = req.params;
    try {
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

// ─── CREATE REVIEW ───────────────────────────────────────────────────────────
const createReview = async (req, res) => {
    const {
        store_id,
        order_id,
        customer_id,
        rating,
        rating_quality,
        rating_punctuality,
        rating_communication,
        comment
    } = req.body;

    if (!store_id || !order_id || !customer_id || !rating) {
        return res.status(400).json({
            success: false,
            message: "Field store_id, order_id, customer_id, dan rating wajib diisi."
        });
    }

    if (rating < 1 || rating > 5) {
        return res.status(400).json({
            success: false,
            message: "Rating harus antara 1 sampai 5."
        });
    }

    try {
        // Cek apakah order sudah pernah direview
        const [existing] = await db.execute(
            `SELECT id FROM reviews WHERE order_id = ? AND customer_id = ?`,
            [order_id, customer_id]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Order ini sudah pernah direview."
            });
        }

        const [result] = await db.execute(`
            INSERT INTO reviews 
                (store_id, order_id, customer_id, rating, rating_quality, rating_punctuality, rating_communication, comment, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
            store_id,
            order_id,
            customer_id,
            rating,
            rating_quality || null,
            rating_punctuality || null,
            rating_communication || null,
            comment || null
        ]);

        res.status(201).json({
            success: true,
            message: "Review berhasil ditambahkan.",
            review_id: result.insertId
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ─── UPDATE REVIEW ───────────────────────────────────────────────────────────
const updateReview = async (req, res) => {
    const { review_id } = req.params;
    const {
        rating,
        rating_quality,
        rating_punctuality,
        rating_communication,
        comment
    } = req.body;

    if (!rating) {
        return res.status(400).json({ success: false, message: "Field rating wajib diisi." });
    }

    try {
        const [existing] = await db.execute(
            `SELECT id FROM reviews WHERE id = ?`, [review_id]
        );

        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: "Review tidak ditemukan." });
        }

        await db.execute(`
            UPDATE reviews
            SET 
                rating = ?,
                rating_quality = ?,
                rating_punctuality = ?,
                rating_communication = ?,
                comment = ?,
                updated_at = NOW()
            WHERE id = ?
        `, [
            rating,
            rating_quality || null,
            rating_punctuality || null,
            rating_communication || null,
            comment || null,
            review_id
        ]);

        res.status(200).json({
            success: true,
            message: "Review berhasil diperbarui."
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ─── DELETE REVIEW ───────────────────────────────────────────────────────────
const deleteReview = async (req, res) => {
    const { review_id } = req.params;

    try {
        const [existing] = await db.execute(
            `SELECT id FROM reviews WHERE id = ?`, [review_id]
        );

        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: "Review tidak ditemukan." });
        }

        await db.execute(`DELETE FROM reviews WHERE id = ?`, [review_id]);

        res.status(200).json({
            success: true,
            message: "Review berhasil dihapus."
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ─── GET REVIEW BY ID ────────────────────────────────────────────────────────
const getReviewById = async (req, res) => {
    const { review_id } = req.params;

    try {
        const [rows] = await db.execute(`
            SELECT 
                r.id AS review_id,
                r.rating,
                r.rating_quality,
                r.rating_punctuality,
                r.rating_communication,
                r.comment,
                r.created_at,
                r.updated_at,
                u.full_name,
                u.profile_picture,
                o.items AS detail_jasa
            FROM reviews r
            JOIN orders o ON r.order_id = o.id
            JOIN users u ON r.customer_id = u.id
            WHERE r.id = ?
        `, [review_id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Review tidak ditemukan." });
        }

        const review = {
            ...rows[0],
            detail_jasa: JSON.parse(rows[0].detail_jasa || '[]')
        };

        res.status(200).json({ success: true, review });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

module.exports = {
    getReviewSummary,
    createReview,
    updateReview,
    deleteReview,
    getReviewById
};