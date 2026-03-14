const express = require('express');
const router = express.Router();
const multer = require('multer');
const assetController = require('../controllers/assetController');

// Simpan di RAM (Memory) untuk menghindari masalah permission di Docker
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } 
});

router.get('/', assetController.getAssets);
router.post('/upload', upload.single('file'), assetController.uploadAndUpdateAsset);

module.exports = router;