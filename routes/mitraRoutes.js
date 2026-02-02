const express = require('express');
const router = express.Router();
const mitraController = require('../controllers/mitraController');
const { authenticateToken } = require('../middlewares/authMiddleware');

// --- KELOMPOK 1: PUBLIC / USER ACCESS ---
router.get('/mitra', mitraController.getAllMitra);
router.get('/mitra/:id', mitraController.getMitraDetail);

// --- KELOMPOK 2: MITRA MANAGEMENT (Auth Required) ---

// AMBIL DATA PROFIL (Agar Form di React Native bisa tampilkan data lama)
router.get('/profile/:id', authenticateToken, mitraController.getStoreProfile);

// UPDATE PROFIL (Untuk Edit Profile & Lengkapi Profile)
router.put('/profile/:id', authenticateToken, mitraController.updateStoreProfile);

// (Opsional) Jika Anda masih ingin memakai path ini untuk pendaftaran pertama
router.put('/complete-profile', authenticateToken, mitraController.updateStoreProfile);


// --- KELOMPOK 3: ADMIN/MAINTENANCE ---
router.put('/manage/:id', authenticateToken, mitraController.updateMitra);
router.delete('/:id', authenticateToken, mitraController.deleteMitra);

module.exports = router;