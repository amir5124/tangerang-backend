const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const assetController = require('../controllers/assetController');

const uploadDir = 'uploads/services/';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `asset-${Date.now()}${path.extname(file.originalname)}`)
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Hanya gambar yang diizinkan!'), false);
    }
});

router.get('/', assetController.getAssets);
router.post('/upload', upload.single('file'), assetController.uploadAndUpdateAsset);

module.exports = router;