const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 5, 
    message: {
        success: false,
        message: "Terlalu banyak percobaan login. Silakan coba lagi setelah 15 menit."
    },
    standardHeaders: true, 
    legacyHeaders: false, 
});

const resetPasswordLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 jam
    max: 3, // Maksimal 3 kali request per jam per IP
    message: {
        success: false,
        message: "Terlalu banyak permintaan reset password. Silakan coba lagi setelah 1 jam."
    }
});

router.post('/register', authController.register);
router.post('/login', loginLimiter, authController.login);
router.post('/google', loginLimiter, authController.googleAuth);
router.get('/profile', authenticateToken, authController.getProfile);
router.post('/logout', authenticateToken, authController.logout);
router.put('/update-profile', authenticateToken, upload.single('image'), authController.updateProfile);
router.put('/change-password', authenticateToken, authController.changePassword);
// 1. Minta link reset (Input Email)
router.post('/request-reset', resetPasswordLimiter, authController.requestReset);
// 2. Eksekusi reset password (Input Password Baru + Token dari Email)
router.post('/reset-password', authController.resetPassword);

module.exports = router;