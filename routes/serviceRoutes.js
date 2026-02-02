const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const serviceController = require('../controllers/serviceController');
const { authenticateToken, isMitra } = require('../middleware/authMiddleware');

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

// --- 4. Routes ---

/**
 * @route   POST /api/services
 * @desc    Tambah jasa baru (Hanya Mitra)
 */
router.post(
    '/',
    authenticateToken,
    isMitra,
    upload.single('image'),
    serviceController.createService
);

/**
 * @route   GET /api/services/store/:store_id
 * @desc    Ambil daftar jasa berdasarkan ID Toko (Public/Customer bisa lihat)
 */
router.get('/store/:store_id', serviceController.getServicesByStore);

/**
 * @route   PUT /api/services/:id
 * @desc    Update data jasa (Hanya Mitra)
 */
router.put(
    '/:id',
    authenticateToken,
    isMitra,
    upload.single('image'),
    serviceController.updateService
);

/**
 * @route   DELETE /api/services/:id
 * @desc    Hapus jasa (Hanya Mitra)
 */
router.delete(
    '/:id',
    authenticateToken,
    isMitra,
    serviceController.deleteService
);

module.exports = router;