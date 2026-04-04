const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middlewares/authMiddleware');
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

router.post('/register', authController.register);
router.post('/login', loginLimiter, authController.login);
router.post('/google', loginLimiter, authController.googleAuth);
router.get('/profile', authenticateToken, authController.getProfile);
router.post('/logout', authenticateToken, authController.logout);
router.put('/update-profile', authenticateToken, authController.updateProfile);
router.put('/change-password', changePassword);

module.exports = router;