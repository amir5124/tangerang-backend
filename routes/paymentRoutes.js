const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Middleware kecil untuk menandai jenis pembayaran secara eksplisit
const markQRIS = (req, res, next) => { req.isQRIS = true; next(); };
const markVA = (req, res, next) => { req.isQRIS = false; next(); };

// Endpoint lama: buat order + payment sekaligus (dipakai order/create Service lama jika masih ada)
router.post('/create', paymentController.createPayment);

// Endpoint BARU: buat payment untuk order yang SUDAH ADA (dipanggil step 2 dari frontend)
router.post('/qris', markQRIS, paymentController.createPaymentForOrder);
router.post('/va', markVA, paymentController.createPaymentForOrder);

// Webhook LinkQu
router.post('/callback', paymentController.handleCallback);

// Polling status
router.get('/check-status/:partnerReff', paymentController.checkPaymentStatus);

// Riwayat
router.get('/history/:customer_id', paymentController.getPaymentHistory);

module.exports = router;