const db = require('../config/db');

// ─── GET REVIEW SUMMARY ─────────────────────────────────────────────────────
const getReviewSummary = async (req, res) => {
    const { store_id } = req.params;
    try {
        // Query 1: Ringkasan rating
        const [summary] = await db.execute(`
            SELECT 
                COUNT(*)                              AS total_reviews,
                ROUND(AVG(rating), 1)                 AS avg_rating,
                ROUND(AVG(rating_quality), 1)         AS avg_quality,
                ROUND(AVG(rating_punctuality), 1)     AS avg_punctuality,
                ROUND(AVG(rating_communication), 1)   AS avg_communication
            FROM reviews
            WHERE store_id = ?
        `, [store_id]);

        // Query 2: Komentar terbaru
        // LEFT JOIN orders  → agar review tetap muncul walau order terhapus
        // LEFT JOIN users   → agar review tetap muncul walau user terhapus
        // Ambil service_name dari order_items (bukan o.items JSON)
        const [comments] = await db.execute(`
            SELECT
                r.id                    AS review_id,
                r.rating,
                r.rating_quality,
                r.rating_punctuality,
                r.rating_communication,
                r.comment,
                r.created_at,
                u.full_name,
                u.profile_picture,
                o.items                 AS detail_jasa
            FROM reviews r
            LEFT JOIN orders o  ON r.order_id  = o.id
            LEFT JOIN users  u  ON r.customer_id = u.id
            WHERE r.store_id = ?
            ORDER BY r.created_at DESC
            LIMIT 10
        `, [store_id]);

        // Parse kolom items (JSON) dengan aman
        const formattedComments = comments.map(item => {
            let detail_jasa = [];
            try {
                if (item.detail_jasa) {
                    detail_jasa = typeof item.detail_jasa === 'string'
                        ? JSON.parse(item.detail_jasa)
                        : item.detail_jasa; // MySQL driver kadang sudah auto-parse JSON
                }
            } catch {
                detail_jasa = [];
            }
            return { ...item, detail_jasa };
        });

        res.status(200).json({
            success: true,
            summary: summary[0],
            latest_comments: formattedComments
        });

    } catch (error) {
        console.error('[getReviewSummary] ❌', error.message);
        console.error('[getReviewSummary] SQL:', error.sql ?? '—');
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── CREATE REVIEW ───────────────────────────────────────────────────────────
const createReview = async (req, res) => {
    const {
        store_id, order_id, customer_id, rating,
        rating_quality, rating_punctuality, rating_communication, comment
    } = req.body;

    if (!store_id || !order_id || !customer_id || !rating) {
        return res.status(400).json({
            success: false,
            message: "Field store_id, order_id, customer_id, dan rating wajib diisi."
        });
    }
    if (rating < 1 || rating > 5) {
        return res.status(400).json({ success: false, message: "Rating harus antara 1 sampai 5." });
    }

    try {
        // Cek duplikat — kolom order_id di reviews bersifat UNIQUE
        const [existing] = await db.execute(
            `SELECT id FROM reviews WHERE order_id = ?`, [order_id]
        );
        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: "Order ini sudah pernah direview." });
        }

        // INSERT — tidak ada kolom updated_at di tabel reviews
        const [result] = await db.execute(`
            INSERT INTO reviews
                (store_id, order_id, customer_id, rating,
                 rating_quality, rating_punctuality, rating_communication, comment)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            store_id, order_id, customer_id, rating,
            rating_quality ?? 5,
            rating_punctuality ?? 5,
            rating_communication ?? 5,
            comment || null
        ]);

        res.status(201).json({
            success: true,
            message: "Review berhasil ditambahkan.",
            review_id: result.insertId
        });
    } catch (error) {
        console.error('[createReview] ❌', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── UPDATE REVIEW ───────────────────────────────────────────────────────────
// CATATAN: tabel reviews TIDAK punya kolom updated_at
const updateReview = async (req, res) => {
    const { review_id } = req.params;
    const { rating, rating_quality, rating_punctuality, rating_communication, comment } = req.body;

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

        // Tidak pakai updated_at karena kolom tersebut tidak ada di tabel reviews
        await db.execute(`
            UPDATE reviews
            SET
                rating                = ?,
                rating_quality        = ?,
                rating_punctuality    = ?,
                rating_communication  = ?,
                comment               = ?
            WHERE id = ?
        `, [
            rating,
            rating_quality ?? 5,
            rating_punctuality ?? 5,
            rating_communication ?? 5,
            comment || null,
            review_id
        ]);

        res.status(200).json({ success: true, message: "Review berhasil diperbarui." });
    } catch (error) {
        console.error('[updateReview] ❌', error.message);
        res.status(500).json({ success: false, message: error.message });
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
        res.status(200).json({ success: true, message: "Review berhasil dihapus." });
    } catch (error) {
        console.error('[deleteReview] ❌', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET REVIEW BY ID ────────────────────────────────────────────────────────
const getReviewById = async (req, res) => {
    const { review_id } = req.params;
    try {
        const [rows] = await db.execute(`
            SELECT
                r.id                    AS review_id,
                r.rating,
                r.rating_quality,
                r.rating_punctuality,
                r.rating_communication,
                r.comment,
                r.created_at,
                u.full_name,
                u.profile_picture,
                o.items                 AS detail_jasa
            FROM reviews r
            LEFT JOIN orders o ON r.order_id   = o.id
            LEFT JOIN users  u ON r.customer_id = u.id
            WHERE r.id = ?
        `, [review_id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Review tidak ditemukan." });
        }

        let detail_jasa = [];
        try {
            if (rows[0].detail_jasa) {
                detail_jasa = typeof rows[0].detail_jasa === 'string'
                    ? JSON.parse(rows[0].detail_jasa)
                    : rows[0].detail_jasa;
            }
        } catch { detail_jasa = []; }

        res.status(200).json({
            success: true,
            review: { ...rows[0], detail_jasa }
        });
    } catch (error) {
        console.error('[getReviewById] ❌', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getAllLatestReviews = async (req, res) => {
    try {
        const [comments] = await db.execute(`
            SELECT
                r.id                    AS review_id,
                r.rating,
                r.comment,
                r.created_at,
                u.full_name,
                u.profile_picture,
                s.name                  AS store_name
            FROM reviews r
            LEFT JOIN users u  ON r.customer_id = u.id
            LEFT JOIN stores s ON r.store_id = s.id
            ORDER BY r.created_at DESC
            LIMIT 10
        `);

        res.status(200).json({
            success: true,
            latest_comments: comments
        });
    } catch (error) {
        console.error('[getAllLatestReviews] ❌', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getReviewSummary,
    createReview,
    updateReview,
    deleteReview,
    getReviewById,
    getAllLatestReviews
};