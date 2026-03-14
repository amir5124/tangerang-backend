const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const assetController = require('../controllers/assetController');

// Menggunakan path absolut untuk memastikan folder berada di root app, 
// yang biasanya dipetakan sebagai Persistent Volume di Coolify.
const uploadDir = path.resolve(__dirname, '../uploads/services');

// Pastikan folder ada dengan hak akses yang benar
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        // Gunakan nama file yang unik dan aman
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

router.get('/', assetController.getAssets);
router.post('/upload', upload.single('file'), assetController.uploadAndUpdateAsset);

module.exports = router;