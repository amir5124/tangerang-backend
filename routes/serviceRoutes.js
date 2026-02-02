const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const serviceController = require('../controllers/serviceController');

// 1. Pastikan folder uploads tersedia
const uploadDir = 'uploads/services/';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// 2. Konfigurasi Storage Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Nama file: 1672531200-nama-file.jpg
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

// 3. Filter tipe file (hanya gambar)
const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Hanya file gambar yang diizinkan!'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 2 * 1024 * 1024 } // Batas 2MB
});

// 4. Routes
// Gunakan upload.single('image') sesuai dengan key yang dikirim dari React Native
router.post('/services', upload.single('image'), serviceController.createService);
router.get('/services/store/:store_id', serviceController.getServicesByStore);
router.put('/services/:id', upload.single('image'), serviceController.updateService);
router.delete('/services/:id', serviceController.deleteService);

module.exports = router;