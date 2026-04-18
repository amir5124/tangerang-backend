const express = require('express');
const router = express.Router();
const assetController = require('../controllers/assetController');

// Route untuk mengambil daftar asset
router.get('/', assetController.getAssets);

// Route untuk upload gambar via Base64 (Mobile friendly)
router.post('/upload-base64', assetController.uploadAndUpdateAssetBase64);

// Route baru untuk mengupdate nama layanan berdasarkan ID
router.put('/update-info/:id', assetController.updateAssetInfo);

module.exports = router;