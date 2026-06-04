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

// ==========================================
// PUBLIC ENDPOINTS (Tanpa Auth)
// ==========================================
router.get('/', mitraController.getAllMitra);
router.get('/:id', mitraController.getMitraDetail);
router.get('/dashboard/:id', mitraController.getMitraDashboard);
router.get('/orders-history/:store_id', mitraController.getAllHistory);

// ✅ PROFILE ENDPOINTS - PUBLIC (tanpa authenticateToken)
router.get('/profile/:id', mitraController.getStoreProfile);
router.put('/profile/:id', upload.single('image'), mitraController.updateStoreProfile);

// ==========================================
// PROTECTED ENDPOINTS (Dengan Auth)
// ==========================================
router.put('/manage/:id', authenticateToken, mitraController.updateMitra);
router.put('/approve/:id', authenticateToken, mitraController.approveMitra);
router.put('/reject/:id', authenticateToken, mitraController.rejectMitra);
router.put('/revert-rejected-to-pending/:id', authenticateToken, mitraController.revertRejectedToPending);
router.put('/revert-approved-to-pending/:id', authenticateToken, mitraController.revertApprovedToPending);
router.put('/:id/commission', authenticateToken, mitraController.updateCommission);
router.delete('/:id', authenticateToken, mitraController.deleteMitra);
router.get('/admin/all-users-with-mitra', authenticateToken, mitraController.getAllUsersWithMitraStatus);
router.put('/reject-mitra-user/:id', authenticateToken, mitraController.rejectMitraUser);
router.post('/create-store-from-user', authenticateToken, mitraController.createStoreFromUser);
router.put('/approve-mitra-user/:id', authenticateToken, mitraController.approveMitraUser);

module.exports = router;