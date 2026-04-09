const express = require('express');
const router = express.Router();
const { getWalletBalance } = require('../controllers/balanceController');
const { authenticateToken } = require('../middlewares/authMiddleware');

// Endpoint: GET /api/balance
// Siapapun yang login bisa akses wallet miliknya sendiri
router.get('/', authenticateToken, getWalletBalance);

module.exports = router;