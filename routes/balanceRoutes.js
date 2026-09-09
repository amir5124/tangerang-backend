const express = require('express');
const router = express.Router();
const { getWalletBalance, getAllBalancesAdmin, getBalanceByEmailAdmin } = require('../controllers/balanceController');
const { authenticateToken } = require('../middlewares/authMiddleware');

// Middleware kecil: pastikan role = admin
const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Akses ditolak. Khusus admin.' });
    }
    next();
};

// Endpoint: GET /api/balance
// Siapapun yang login bisa akses wallet miliknya sendiri
router.get('/', authenticateToken, getWalletBalance);

// Endpoint: GET /api/balance/admin/all?search=&role=
// Khusus admin — lihat saldo semua user
router.get('/admin/all', authenticateToken, getAllBalancesAdmin);

// Endpoint: GET /api/balance/admin/:email
// Khusus admin — cek saldo user spesifik by email
router.get('/admin/:email', authenticateToken, getBalanceByEmailAdmin);

module.exports = router;