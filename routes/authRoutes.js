const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middlewares/authMiddleware');

// --- PUBLIC ROUTES ---
router.post('/register', authController.register);
router.post('/login', authController.login);

// Tambahkan rute Google Auth di sini
router.post('/google', authController.googleAuth);

// --- PROTECTED ROUTES (Perlu Login) ---
// Gunakan authenticateToken agar user_id diambil dari token, bukan kiriman body yang bisa dimanipulasi
router.post('/logout', authenticateToken, authController.logout);
router.put('/update-profile', authenticateToken, authController.updateProfile);

module.exports = router;