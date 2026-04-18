const express = require('express');
const router = express.Router();
const assetController = require('../controllers/assetController');

// Ambil semua asset
router.get('/', assetController.getAssets);

// Tambah asset baru (Nama & Key)
router.post('/', assetController.createAsset);

// Upload/Update foto asset
router.post('/upload-base64', assetController.uploadAndUpdateAssetBase64);

// Update nama tampilan asset
router.put('/update-info/:id', assetController.updateAssetInfo);

// Hapus asset
router.delete('/:id', assetController.deleteAsset);

module.exports = router;