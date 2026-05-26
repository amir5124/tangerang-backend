const express = require('express');
const router = express.Router();
const bankController = require('../controllers/bankController');



// Route untuk bank accounts
router.get('/list', bankController.getBankList);
router.post('/accounts', bankController.addBankAccount);
router.get('/accounts', bankController.getBankAccounts);
router.get('/accounts/active', bankController.getActiveBankAccount);
router.put('/accounts/:id', bankController.updateBankAccount);
router.delete('/accounts/:id', bankController.deleteBankAccount);
router.patch('/accounts/:id/active', bankController.setActiveBankAccount);

module.exports = router;