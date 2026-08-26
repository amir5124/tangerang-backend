// routes/complaintRoutes.js
const express = require('express');
const router = express.Router();
const complaintController = require('../controllers/complaintController');

// ============================================================
// ROUTES KOMPLAIN
// ============================================================

// USER: ajukan komplain atas pesanan
router.post('/', complaintController.createComplaint);

// USER: cek voucher diskon aktif (dipakai untuk banner sebelum order baru)
router.get('/voucher/:cust_id', complaintController.getActiveDiscountVoucher);

// USER: riwayat komplain milik customer
router.get('/customer/:cust_id', complaintController.getComplaintsByCustomer);

// ADMIN: semua komplain (bisa filter ?status=pending)
router.get('/', complaintController.getAllComplaints);

// ADMIN: detail komplain
router.get('/:id', complaintController.getComplaintById);

// ADMIN: approve / reject
// ⚠️ TODO: pasang middleware auth-admin di 2 route ini sebelum production,
// supaya bukan sembarang orang bisa approve komplain & nerbitin voucher gratis.
router.put('/:id/approve', complaintController.approveComplaint);
router.put('/:id/reject', complaintController.rejectComplaint);

module.exports = router;

// ============================================================
// Tambahkan ini di app.js utama:
//
//   const complaintRoutes = require('./routes/complaintRoutes');
//   app.use('/api/complaints', complaintRoutes);
// ============================================================