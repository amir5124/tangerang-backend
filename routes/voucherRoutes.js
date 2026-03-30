const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');

// Endpoint: POST /api/voucher/validate
router.get('/', voucherController.getVouchers);
router.put('/:id', voucherController.updateVoucher);
router.post('/validate', voucherController.validateVoucher);

module.exports = router;