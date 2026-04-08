const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const mitraController = require('../controllers/mitraController');
const { authenticateToken } = require('../middlewares/authMiddleware');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/services/');
    },
    filename: (req, file, cb) => {
        cb(null, `logo-${Date.now()}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } 
});


router.get('/', mitraController.getAllMitra);
router.get('/:id', mitraController.getMitraDetail);

router.get('/dashboard/:id', mitraController.getMitraDashboard);
router.get('/orders-history/:store_id', mitraController.getAllHistory);
router.get('/profile/:id', authenticateToken, mitraController.getStoreProfile);
router.put('/profile/:id', authenticateToken, upload.single('image'), mitraController.updateStoreProfile);
router.put('/manage/:id', authenticateToken, mitraController.updateMitra);
router.put('/approve/:id', mitraController.approveMitra);
router.delete('/:id', authenticateToken, mitraController.deleteMitra);

module.exports = router;