const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');

// --- Routes Standar (Single & General) ---

// Mendapatkan semua daftar voucher
router.get('/', voucherController.getVouchers);

// Validasi voucher (digunakan di halaman checkout/keranjang)
router.post('/validate', voucherController.validateVoucher);

// Memperbarui satu voucher berdasarkan ID
router.put('/:id', voucherController.updateVoucher);


// --- Routes Operasi Massal (Bulk Operations) ---

// Membuat banyak voucher sekaligus
// Endpoint: POST /api/vouchers/bulk-create
router.post('/bulk-create', voucherController.bulkCreateVouchers);

// Menghapus banyak voucher sekaligus
// Endpoint: DELETE /api/vouchers/bulk-delete
router.delete('/bulk-delete', voucherController.bulkDeleteVouchers);

// Mengubah status aktif/non-aktif banyak voucher sekaligus
// Endpoint: PATCH /api/vouchers/bulk-status
router.patch('/bulk-status', voucherController.bulkUpdateStatus);

module.exports = router;