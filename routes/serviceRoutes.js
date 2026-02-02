const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const serviceController = require('../controllers/serviceController');
const { authenticateToken, isMitra } = require('../middlewares/authMiddleware');

// 1. Setup Folder
const uploadDir = 'uploads/services/';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// 2. Multer Config
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'service-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Hanya gambar yang diizinkan!'), false);
    }
});

// --- 3. Routes ---

// Publik: Lihat jasa toko
router.get('/store/:store_id', serviceController.getServicesByStore);

// Khusus Mitra: Tambah Jasa
router.post('/', authenticateToken, isMitra, upload.single('image'), serviceController.createService);

// Khusus Mitra: Edit Jasa (Mendukung ganti gambar)
router.put('/:id', authenticateToken, isMitra, upload.single('image'), serviceController.updateService);

// Khusus Mitra: Hapus Jasa
router.delete('/:id', authenticateToken, isMitra, serviceController.deleteService);

module.exports = router;