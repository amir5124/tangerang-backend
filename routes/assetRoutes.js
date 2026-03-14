const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const assetController = require('../controllers/assetController');

// 1. Setup Folder
const uploadDir = 'uploads/services/';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// 2. Multer Config (Sama persis dengan serviceRoutes)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `asset-${Date.now()}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Hanya gambar yang diizinkan!'), false);
    }
});

// 3. Routes
router.get('/', assetController.getAssets);
// Pastikan field-nya adalah 'file' agar sesuai dengan React Native
router.post('/upload', upload.single('file'), assetController.uploadAndUpdateAsset);

module.exports = router;