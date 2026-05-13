const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');
const upload = require('../middlewares/upload');

// Upload single image untuk voucher (maks 10MB)
router.post('/upload-image', upload.single('image'), voucherController.uploadVoucherImage);

// Route untuk menghapus gambar
router.delete('/image/:id', voucherController.deleteVoucherImage);

router.get('/', voucherController.getVouchers);
router.post('/validate', voucherController.validateVoucher);
router.put('/:id', voucherController.updateVoucher);

// Bulk routes — dua nama agar kompatibel dengan frontend lama & baru
router.post('/bulk', voucherController.bulkCreateVouchers);
router.post('/bulk-create', voucherController.bulkCreateVouchers);

router.delete('/bulk', voucherController.bulkDeleteVouchers);
router.delete('/bulk-delete', voucherController.bulkDeleteVouchers);

router.patch('/bulk-status', voucherController.bulkUpdateStatus);

module.exports = router;