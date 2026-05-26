const express = require('express');
const router = express.Router();
const bankController = require('../controllers/bankController');
const { authenticateToken, isCustomer } = require('../middlewares/authMiddleware');

// 🔐 Terapkan autentikasi untuk SEMUA route di sini
router.use(authenticateToken);   // <-- WAJIB
router.use(isCustomer);          // <-- opsional, jika hanya untuk customer

// Route untuk bank accounts
router.get('/list', bankController.getBankList);
router.post('/accounts', bankController.addBankAccount);
router.get('/accounts', bankController.getBankAccounts);
router.get('/accounts/active', bankController.getActiveBankAccount);
router.put('/accounts/:id', bankController.updateBankAccount);
router.delete('/accounts/:id', bankController.deleteBankAccount);
router.patch('/accounts/:id/active', bankController.setActiveBankAccount);

module.exports = router;