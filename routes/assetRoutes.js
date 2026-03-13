const express = require('express');
const router = express.Router();
const assetController = require('../controllers/assetController');
const upload = require('../middlewares/upload');

// Pastikan fungsi-fungsi ini ada di controller
router.get('/', assetController.getAssets);
router.post('/upload', upload.single('file'), assetController.uploadAndUpdateAsset);

module.exports = router;