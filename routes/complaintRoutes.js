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
// File ini di-mount sebagai SUB-ROUTER di dalam routes/artRoutes.js:
//
//   const complaintRoutes = require('./complaintRoutes');
//   router.use('/complaints', complaintRoutes);
//
// Jadi endpoint final-nya jadi (di bawah app.use('/api/pesanan', artRoutes)):
//   POST /api/pesanan/complaints
//   GET  /api/pesanan/complaints
//   GET  /api/pesanan/complaints/:id
//   GET  /api/pesanan/complaints/customer/:cust_id
//   GET  /api/pesanan/complaints/voucher/:cust_id
//   PUT  /api/pesanan/complaints/:id/approve
//   PUT  /api/pesanan/complaints/:id/reject
//
// TIDAK perlu lagi app.use('/api/complaints', ...) terpisah di app.js.
// ============================================================