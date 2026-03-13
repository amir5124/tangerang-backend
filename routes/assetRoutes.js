const express = require('express');
const router = express.Router();
const assetController = require('../controllers/assetController');

router.get('/', assetController.getAssets);

router.post('/update', assetController.updateAsset);

module.exports = router;