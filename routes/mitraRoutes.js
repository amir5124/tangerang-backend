const express = require('express');
const router = express.Router();
const mitraController = require('../controllers/mitraController');

// Endpoint untuk aplikasi user melihat daftar vendor
router.get('/mitra', mitraController.getAllMitra);
router.get('/mitra/:id', mitraController.getMitraDetail);

// Endpoint untuk manajemen mitra (dashboard admin/mitra)
router.put('/mitra/:id', mitraController.updateMitra);
router.delete('/mitra/:id', mitraController.deleteMitra);

module.exports = router;