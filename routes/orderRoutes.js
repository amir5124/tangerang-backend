const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const multer = require('multer');
const path = require('path');

// Konfigurasi Penyimpanan Foto
const storage = multer.diskStorage({
    destination: 'uploads/work_evidence/',
    filename: (req, file, cb) => {
        cb(null, `finish-${Date.now()}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage: storage });

// Endpoint yang sudah ada
router.post('/create', orderController.createOrder);
router.get('/detail/:id', orderController.getOrderDetail);

// TAMBAHKAN INI: Update Status (Mendukung upload foto 'image')
router.post('/:id/update-status', upload.single('image'), orderController.updateOrderStatus);

module.exports = router;