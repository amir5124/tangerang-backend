const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.post('/register', authController.register);
router.post('/login', authController.login);

// Tambahkan ini:
router.post('/logout', authenticateToken, authController.logout);

module.exports = router;