// routes/artRoutes.js
const express = require('express');
const router = express.Router();
const artController = require('../controllers/artController');
const complaintRoutes = require('./complaintRoutes');

// ============================================================
// ROUTES PESANAN (ART)
// ============================================================

// GET: Semua pesanan
router.get('/', artController.getAllPesanan);

router.get('/active/:cust_id', artController.getActivePesananByCustomer);
router.get('/matching-status/:matching_status', artController.getPesananByMatchingStatus);
router.put('/:id/matching', artController.updateMatchingStatus);

// GET: Statistik pesanan
router.get('/statistik', artController.getStatistikPesanan);

// GET: Laporan per tanggal
router.get('/laporan', artController.getLaporanPerTanggal);

// ============================================================
// 🔥 FITUR KOMPLAIN — dimount di /api/pesanan/complaints/...
// HARUS didaftarkan SEBELUM router.get('/:id', ...) di bawah,
// supaya "complaints" tidak ketangkep sebagai :id.
// ============================================================
router.use('/complaints', complaintRoutes);

// GET: Pesanan by status
router.get('/status/:status', artController.getPesananByStatus);

// GET: Pesanan by customer
router.get('/customer/:cust_id', artController.getPesananByCustomer);

// GET: Pesanan by worker
router.get('/worker/:worker_id', artController.getPesananByWorker);

// NEW: GET History status pesanan (untuk fitur History Pesanan sisi user)
router.get('/:id/history', artController.getPesananHistory);

// GET: Pesanan by ID
router.get('/:id', artController.getPesananById);

// POST: Buat pesanan baru
router.post('/', artController.createPesanan);

// PUT: Update pesanan
router.put('/:id', artController.updatePesanan);

// PUT: Update status pesanan
router.put('/:id/status', artController.updateStatusPesanan);

// DELETE: Hapus pesanan
router.delete('/:id', artController.deletePesanan);

module.exports = router;

// ============================================================
// Di app.js utama, tetap cukup satu baris ini seperti sebelumnya:
//
//   app.use('/api/pesanan', artRoutes);
//
// TIDAK perlu lagi app.use('/api/complaints', ...) terpisah.
// ============================================================