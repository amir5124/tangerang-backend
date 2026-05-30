const express = require('express');
const router = express.Router();
const bankController = require('../controllers/bankController');
const { authenticateToken } = require('../middlewares/authMiddleware');

// 🔐 Terapkan autentikasi untuk SEMUA route di sini
// Hanya perlu login, tidak perlu cek role spesifik
router.use(authenticateToken);   // <-- WAJIB untuk semua yang login

// Route untuk bank accounts - SEMUA user yang sudah login bisa akses
router.get('/list', bankController.getBankList);
router.post('/accounts', bankController.addBankAccount);
router.get('/accounts', bankController.getBankAccounts);
router.get('/accounts/active', bankController.getActiveBankAccount);
router.put('/accounts/:id', bankController.updateBankAccount);
router.delete('/accounts/:id', bankController.deleteBankAccount);
router.patch('/accounts/:id/active', bankController.setActiveBankAccount);

module.exports = router;