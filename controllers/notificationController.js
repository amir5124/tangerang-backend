const admin = require('../config/firebaseConfig');

exports.sendTopicBroadcast = async (req, res) => {
    const { targetTopic, title, body, data } = req.body;
    const allowedTopics = ['all_mitra', 'all_customer'];
    
    if (!allowedTopics.includes(targetTopic)) {
        return res.status(400).json({ success: false, message: "Topik tidak valid" });
    }

    const message = {
        notification: { title, body },
        data: { ...data, type: "BROADCAST", timestamp: new Date().toISOString() },
        topic: targetTopic,
        android: { priority: "high", notification: { channelId: "orders" } },
        apns: { payload: { aps: { sound: "default" } } }
    };

    try {
        await admin.messaging().send(message);
        res.status(200).json({ success: true, message: "Broadcast terkirim" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.subscribeToTopic = async (req, res) => {
    const { token, role } = req.body;
    const topic = role === 'mitra' ? 'all_mitra' : 'all_customer';
    try {
        await admin.messaging().subscribeToTopic([token], topic);
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};