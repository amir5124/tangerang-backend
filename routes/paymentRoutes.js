const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Endpoint untuk membuat pembayaran (VA/QRIS)
router.post('/create', paymentController.createPayment);

// Endpoint Webhook untuk menerima notifikasi dari LinkQu
router.post('/callback', paymentController.handleCallback);

// Endpoint Polling untuk cek status manual
router.get('/check-status/:partnerReff', paymentController.checkPaymentStatus);

// ENDPOINT BARU: Ambil riwayat pembayaran & pesanan milik customer
router.get('/history/:customer_id', paymentController.getPaymentHistory);

module.exports = router;