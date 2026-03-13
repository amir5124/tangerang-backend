const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');

router.post('/broadcast', notificationController.sendTopicBroadcast);

module.exports = router;