const express = require('express');
const router = express.Router();
const { getWalletBalance } = require('../controllers/balanceController');
const { authenticateToken } = require('../middleware/authMiddleware'); // Menggunakan middleware kamu

// Endpoint: GET /api/balance
// Siapapun yang login bisa akses wallet miliknya sendiri
router.get('/', authenticateToken, getWalletBalance);

module.exports = router;