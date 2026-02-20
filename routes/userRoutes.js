const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// Route untuk mengambil semua data pengguna (Admin Side)
// Endpoint: GET /api/users/admin/all-users
router.get('/admin/all-users', userController.getAllUsers);

module.exports = router;