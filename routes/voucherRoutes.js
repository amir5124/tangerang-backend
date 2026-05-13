const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');

router.get('/', voucherController.getVouchers);
router.post('/validate', voucherController.validateVoucher);
router.put('/:id', voucherController.updateVoucher);

// Bulk routes — dua nama agar kompatibel dengan frontend lama & baru
router.post('/bulk', voucherController.bulkCreateVouchers);       // ← tambah ini
router.post('/bulk-create', voucherController.bulkCreateVouchers);

router.delete('/bulk', voucherController.bulkDeleteVouchers);     // ← tambah ini
router.delete('/bulk-delete', voucherController.bulkDeleteVouchers);

router.patch('/bulk-status', voucherController.bulkUpdateStatus);

module.exports = router;