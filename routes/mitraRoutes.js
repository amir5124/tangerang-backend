const express = require('express');
const router = express.Router();
const mitraController = require('../controllers/mitraController');
const storeController = require('../controllers/storeController');
const { authenticateToken } = require('../middlewares/authMiddleware');

// --- KELOMPOK 1: PUBLIC / USER ACCESS ---
// Untuk aplikasi Customer melihat daftar vendor/mitra
router.get('/mitra', mitraController.getAllMitra);
router.get('/mitra/:id', mitraController.getMitraDetail);


// --- KELOMPOK 2: MITRA MANAGEMENT (Auth Required) ---
// Route untuk melengkapi profil pertama kali (Setelah register akun)
router.put('/mitra/complete-profile', authenticateToken, storeController.completeMitraProfile);

// Route untuk update profil toko (perubahan data berkala)
router.put('/mitra/profile/:id', authenticateToken, storeController.updateStoreProfile);


// --- KELOMPOK 3: ADMIN/MAINTENANCE ---
// Update umum (is_active, dll) dan Delete
router.put('/mitra/manage/:id', authenticateToken, mitraController.updateMitra);
router.delete('/mitra/:id', authenticateToken, mitraController.deleteMitra);

module.exports = router;