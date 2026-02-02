const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

// Endpoint POST /api/orders/create
router.post('/create', orderController.createOrder);

module.exports = router;