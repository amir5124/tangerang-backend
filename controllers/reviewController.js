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
            WHERE store_id = ? AND is_displayed = 1
        `, [store_id]);

        // Query 2: Komentar terbaru (hanya yang ditampilkan)
        const [comments] = await db.execute(`
            SELECT
                r.id                    AS review_id,
                r.rating,
                r.rating_quality,
                r.rating_punctuality,
                r.rating_communication,
                r.comment,
                r.created_at,
                r.is_displayed,
                u.full_name,
                u.profile_picture,
                o.items                 AS detail_jasa
            FROM reviews r
            LEFT JOIN orders o  ON r.order_id  = o.id
            LEFT JOIN users  u  ON r.customer_id = u.id
            WHERE r.store_id = ? AND r.is_displayed = 1
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
                        : item.detail_jasa;
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

        // INSERT — default is_displayed = 0 (perlu persetujuan admin)
        const [result] = await db.execute(`
            INSERT INTO reviews
                (store_id, order_id, customer_id, rating,
                 rating_quality, rating_punctuality, rating_communication, comment, is_displayed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        `, [
            store_id, order_id, customer_id, rating,
            rating_quality ?? 5,
            rating_punctuality ?? 5,
            rating_communication ?? 5,
            comment || null
        ]);

        res.status(201).json({
            success: true,
            message: "Review berhasil ditambahkan. Menunggu persetujuan admin untuk ditampilkan.",
            review_id: result.insertId
        });
    } catch (error) {
        console.error('[createReview] ❌', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── UPDATE REVIEW ───────────────────────────────────────────────────────────
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
                r.is_displayed,
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

// ─── GET ALL LATEST REVIEWS (HANYA YANG DITAMPILKAN) ─────────────────────────
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
                s.store_name            
            FROM reviews r
            LEFT JOIN users u  ON r.customer_id = u.id
            LEFT JOIN stores s ON r.store_id = s.id
            WHERE r.is_displayed = 1
            ORDER BY r.created_at DESC
            LIMIT 10
        `);

        res.status(200).json({
            success: true,
            latest_comments: comments
        });
    } catch (error) {
        console.error('[getAllLatestReviews] ❌', error.message);
        res.status(500).json({
            success: false,
            message: "Gagal mengambil ulasan terbaru",
            error: error.message
        });
    }
};

// ─── NEW: GET ALL REVIEWS FOR ADMIN (DENGAN STATUS TAMPIL) ───────────────────
const getAllReviewsForAdmin = async (req, res) => {
    try {
        const [reviews] = await db.execute(`
            SELECT
                r.id                    AS review_id,
                r.rating,
                r.rating_quality,
                r.rating_punctuality,
                r.rating_communication,
                r.comment,
                r.created_at,
                r.is_displayed,
                u.full_name AS customer_name,
                u.email AS customer_email,
                u.phone_number AS customer_phone,
                s.store_name,
                s.id AS store_id,
                o.id AS order_id
            FROM reviews r
            LEFT JOIN users u ON r.customer_id = u.id
            LEFT JOIN stores s ON r.store_id = s.id
            LEFT JOIN orders o ON r.order_id = o.id
            ORDER BY r.created_at DESC
        `);

        res.status(200).json({
            success: true,
            reviews: reviews
        });
    } catch (error) {
        console.error('[getAllReviewsForAdmin] ❌', error.message);
        res.status(500).json({
            success: false,
            message: "Gagal mengambil daftar review",
            error: error.message
        });
    }
};

// ─── NEW: TOGGLE REVIEW DISPLAY STATUS ───────────────────────────────────────
const toggleReviewDisplay = async (req, res) => {
    const { review_id } = req.params;
    const { is_displayed } = req.body;

    if (is_displayed === undefined) {
        return res.status(400).json({
            success: false,
            message: "Field is_displayed wajib diisi (true/false)"
        });
    }

    try {
        const [existing] = await db.execute(
            `SELECT id FROM reviews WHERE id = ?`, [review_id]
        );
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: "Review tidak ditemukan." });
        }

        await db.execute(`
            UPDATE reviews SET is_displayed = ? WHERE id = ?
        `, [is_displayed ? 1 : 0, review_id]);

        res.status(200).json({
            success: true,
            message: is_displayed ? "Review akan ditampilkan di aplikasi" : "Review disembunyikan dari aplikasi"
        });
    } catch (error) {
        console.error('[toggleReviewDisplay] ❌', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── NEW: BULK UPDATE REVIEW DISPLAY STATUS ──────────────────────────────────
const bulkUpdateReviewDisplay = async (req, res) => {
    const { review_ids, is_displayed } = req.body;

    if (!review_ids || !Array.isArray(review_ids) || review_ids.length === 0) {
        return res.status(400).json({
            success: false,
            message: "review_ids harus berupa array non-kosong"
        });
    }

    if (is_displayed === undefined) {
        return res.status(400).json({
            success: false,
            message: "Field is_displayed wajib diisi (true/false)"
        });
    }

    try {
        const placeholders = review_ids.map(() => '?').join(',');
        await db.execute(
            `UPDATE reviews SET is_displayed = ? WHERE id IN (${placeholders})`,
            [is_displayed ? 1 : 0, ...review_ids]
        );

        res.status(200).json({
            success: true,
            message: `${review_ids.length} review berhasil diupdate`,
            updated_count: review_ids.length
        });
    } catch (error) {
        console.error('[bulkUpdateReviewDisplay] ❌', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── NEW: GET REVIEW STATISTICS FOR ADMIN ────────────────────────────────────
const getReviewStatistics = async (req, res) => {
    try {
        const [stats] = await db.execute(`
            SELECT
                COUNT(*) AS total_reviews,
                SUM(CASE WHEN is_displayed = 1 THEN 1 ELSE 0 END) AS displayed_reviews,
                SUM(CASE WHEN is_displayed = 0 THEN 1 ELSE 0 END) AS hidden_reviews,
                ROUND(AVG(rating), 1) AS avg_rating,
                COUNT(DISTINCT store_id) AS stores_with_reviews
            FROM reviews
        `);

        const [ratingDistribution] = await db.execute(`
            SELECT 
                rating,
                COUNT(*) AS count
            FROM reviews
            GROUP BY rating
            ORDER BY rating DESC
        `);

        res.status(200).json({
            success: true,
            statistics: stats[0],
            rating_distribution: ratingDistribution
        });
    } catch (error) {
        console.error('[getReviewStatistics] ❌', error.message);
        res.status(500).json({
            success: false,
            message: "Gagal mengambil statistik review",
            error: error.message
        });
    }
};

module.exports = {
    getReviewSummary,
    createReview,
    updateReview,
    deleteReview,
    getReviewById,
    getAllLatestReviews,
    getAllReviewsForAdmin,
    toggleReviewDisplay,
    bulkUpdateReviewDisplay,
    getReviewStatistics
};