// routes/artPaymentRoutes.js
const express = require('express');
const router = express.Router();
const artPaymentController = require('../controllers/artPaymentController');

// ============================================================
// ART PAYMENT ROUTES
// ============================================================

// 🔥 Buat pembayaran ART
router.post('/create', artPaymentController.createArtPayment);

// 🔥 Webhook callback dari LinkQu
router.post('/callback', artPaymentController.handleArtCallback);

// 🔥 Cek status pembayaran ART
router.get('/status/:partnerReff', artPaymentController.checkArtPaymentStatus);

module.exports = router;