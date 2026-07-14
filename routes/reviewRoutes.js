const express = require('express');
const router = express.Router();
const {
    getReviewSummary,
    getReviewSummaryPublic,
    createReview,
    updateReview,
    deleteReview,
    getReviewById,
    getAllLatestReviews,
    getAllReviewsForAdmin,
    toggleReviewDisplay,
    bulkUpdateReviewDisplay,
    getReviewStatistics
} = require('../controllers/reviewController');

// ─── ADMIN ROUTES ──────────────────────────────────────────────────────────
// GET    /api/reviews/admin/all          → Semua review untuk admin
router.get('/admin/all', getAllReviewsForAdmin);

// GET    /api/reviews/admin/statistics   → Statistik review untuk admin
router.get('/admin/statistics', getReviewStatistics);

// PUT    /api/reviews/admin/toggle/:review_id → Toggle status tampil review
router.put('/admin/toggle/:review_id', toggleReviewDisplay);

// POST   /api/reviews/admin/bulk-toggle → Bulk update status tampil review
router.post('/admin/bulk-toggle', bulkUpdateReviewDisplay);

// ─── PUBLIC ROUTES ─────────────────────────────────────────────────────────
// GET    /api/reviews/latest-all        → Semua review terbaru (hanya yang ditampilkan)
router.get('/latest-all', getAllLatestReviews);

// GET    /api/reviews/store/:store_id   → Ringkasan + komentar terbaru toko (hanya yang ditampilkan)
router.get('/store/:store_id', getReviewSummary);
router.get('/store/:store_id/all', getReviewSummaryPublic);


// GET    /api/reviews/:review_id        → Detail satu review
router.get('/:review_id', getReviewById);

// POST   /api/reviews                   → Buat review baru
router.post('/', createReview);

// PUT    /api/reviews/:review_id        → Edit review
router.put('/:review_id', updateReview);

// DELETE /api/reviews/:review_id        → Hapus review
router.delete('/:review_id', deleteReview);

module.exports = router;