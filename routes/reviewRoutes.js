const express = require('express');
const router = express.Router();
const {
    getReviewSummary,
    createReview,
    updateReview,
    deleteReview,
    getReviewById,
    getAllLatestReviews
} = require('../controllers/reviewController');

// GET    /api/reviews/store/:store_id   → Ringkasan + komentar terbaru toko
router.get('/store/:store_id', getReviewSummary);

// GET    /api/reviews/:review_id        → Detail satu review
router.get('/:review_id', getReviewById);

// POST   /api/reviews                   → Buat review baru
router.post('/', createReview);

// PUT    /api/reviews/:review_id        → Edit review
router.put('/:review_id', updateReview);

// DELETE /api/reviews/:review_id        → Hapus review
router.delete('/:review_id', deleteReview);
router.get('/latest-all', getAllLatestReviews);

module.exports = router;