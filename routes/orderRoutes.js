const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: 'uploads/work_evidence/',
    filename: (req, file, cb) => {
        cb(null, `finish-${Date.now()}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage: storage });

router.post('/create', orderController.createOrder);
router.post('/create-product', orderController.createOrderWithProducts);
router.post('/cancel', orderController.cancelOrder);
router.get('/detail/:id', orderController.getOrderDetail);
router.get('/user/:userId', orderController.getUserOrders);
router.get('/store/:storeId', orderController.getStoreOrders);
router.put('/store/:id/update-status', orderController.updateOrderStatusByStore);
router.post('/:id/update-status', upload.single('image'), orderController.updateOrderStatus);
router.post('/:id/complete-customer', orderController.customerCompleteOrder);
router.get('/admin/all', orderController.getAllOrdersAdmin);
router.get('/admin/refund-history', orderController.getRefundHistory);

module.exports = router;