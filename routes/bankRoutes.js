const express = require('express');
const router = express.Router();
const bankController = require('../controllers/bankController');



// Route untuk bank accounts
router.get('/banks/list', bankController.getBankList);
router.post('/banks/accounts', bankController.addBankAccount);
router.get('/banks/accounts', bankController.getBankAccounts);
router.get('/banks/accounts/active', bankController.getActiveBankAccount);
router.put('/banks/accounts/:id', bankController.updateBankAccount);
router.delete('/banks/accounts/:id', bankController.deleteBankAccount);
router.patch('/banks/accounts/:id/active', bankController.setActiveBankAccount);

module.exports = router;