const express = require('express');
const router = express.Router();
const controller = require('../controllers/notificationController');

// POST untuk kirim dan subscribe
router.post('/broadcast', controller.sendTopicBroadcast);
router.post('/subscribe', controller.subscribeToTopic);

// GET history untuk ChatScreen
router.get('/:user_id', controller.getNotificationHistory);

// PUT untuk update status baca
router.put('/read/:id', controller.markAsRead);

module.exports = router;