const express = require('express');
const router = express.Router();
const { getRefundCandidates, adminRefundOrder } = require('../controllers/refundController');
const { authenticateToken } = require('../middlewares/authMiddleware');

const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Akses ditolak. Khusus admin.' });
    }
    next();
};

// GET  /api/admin/refund/candidates  -> order yang sudah dibayar tapi belum direfund
router.get('/refund/candidates', authenticateToken, requireAdmin, getRefundCandidates);

// POST /api/admin/refund/:orderId    -> body: { "reason": "...", "amount": 247880 (opsional) }
router.post('/refund/:orderId', authenticateToken, requireAdmin, adminRefundOrder);

module.exports = router;