const express = require('express');
const router = express.Router();
const controller = require('../controllers/notificationController');

router.post('/broadcast', controller.sendTopicBroadcast);
router.post('/subscribe', controller.subscribeToTopic);

module.exports = router;