const express = require('express');
const router = express.Router();
const { getReviewSummary } = require('../controllers/reviewController');

// Endpoint: /api/reviews/store/:store_id
router.get('/store/:store_id', getReviewSummary);

module.exports = router;