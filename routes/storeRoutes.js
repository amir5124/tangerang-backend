const express = require('express');
const router = express.Router();
const storeController = require('../controllers/storeController');
const { authenticateToken, isMitra } = require('../middleware/authMiddleware');

// Route untuk melengkapi atau mengupdate profil toko
// URL: PUT /api/stores/profile/:id
router.put('/profile/:id', authenticateToken, isMitra, storeController.updateStoreProfile);

// Route untuk mengambil detail toko berdasarkan ID
// URL: GET /api/stores/:id
router.get('/:id', authenticateToken, storeController.getStoreDetail);

module.exports = router;