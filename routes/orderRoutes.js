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

// --- ENDPOINT YANG SUDAH ADA ---
router.post('/create', orderController.createOrder);
router.get('/detail/:id', orderController.getOrderDetail);
// Ambil semua order berdasarkan ID user (Customer)
router.get('/user/:userId', orderController.getUserOrders);

// --- ENDPOINT MITRA ---
// Digunakan mitra untuk update status (Accepted, OTW, Working, Completed)
router.post('/:id/update-status', upload.single('image'), orderController.updateOrderStatus);

// --- ENDPOINT CUSTOMER (BARU) ---
// Digunakan customer untuk konfirmasi selesai + kirim rating + cairkan dana
router.post('/:id/complete-customer', orderController.customerCompleteOrder);
router.get('/admin/all', orderController.getAllOrdersAdmin);

module.exports = router;