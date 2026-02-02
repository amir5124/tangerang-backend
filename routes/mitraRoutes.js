const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const mitraController = require('../controllers/mitraController');
const { authenticateToken } = require('../middlewares/authMiddleware');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Arahkan ke sub-folder services
        cb(null, 'uploads/services/');
    },
    filename: (req, file, cb) => {
        cb(null, `logo-${Date.now()}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // Batas 5MB agar tidak berat
});

// --- KELOMPOK 1: PUBLIC ---
router.get('/', mitraController.getAllMitra);
router.get('/:id', mitraController.getMitraDetail);

// --- KELOMPOK 2: MITRA MANAGEMENT ---

// Ambil Profil
router.get('/profile/:id', authenticateToken, mitraController.getStoreProfile);

// Update Profil (Menggunakan upload.single('image') untuk menangkap foto)
router.put('/profile/:id', authenticateToken, upload.single('image'), mitraController.updateStoreProfile);

// --- KELOMPOK 3: ADMIN ---
router.put('/manage/:id', authenticateToken, mitraController.updateMitra);
router.delete('/:id', authenticateToken, mitraController.deleteMitra);

module.exports = router;