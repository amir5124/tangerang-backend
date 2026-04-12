const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const multer = require('multer');
const path = require('path');

// Konfigurasi Penyimpanan Foto Bukti Kerja Mitra
const storage = multer.diskStorage({
    destination: 'uploads/work_evidence/',
    filename: (req, file, cb) => {
        cb(null, `finish-${Date.now()}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage: storage });
router.post('/create', orderController.createOrder);
router.get('/detail/:id', orderController.getOrderDetail);
router.get('/user/:userId', orderController.getUserOrders);
router.post('/:id/update-status', upload.single('image'), orderController.updateOrderStatus);
router.post('/:id/complete-customer', orderController.customerCompleteOrder);
router.get('/admin/all', orderController.getAllOrdersAdmin);
router.get('/admin/refund-history', orderController.getRefundHistory);

module.exports = router;