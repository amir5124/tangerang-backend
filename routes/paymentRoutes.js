const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Endpoint tunggal yang cerdas (bisa VA atau QRIS tergantung body.method)
router.post('/create', paymentController.createPayment);
router.post('/callback', paymentController.handleCallback);
router.get('/check-status/:partnerReff', paymentController.checkPaymentStatus);

module.exports = router;