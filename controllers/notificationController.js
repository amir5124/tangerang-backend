const admin = require('../config/firebaseConfig');

exports.sendTopicBroadcast = async (req, res) => {
    const { targetTopic, title, body, data } = req.body;

    const allowedTopics = ['all_mitra', 'all_customer'];
    if (!allowedTopics.includes(targetTopic)) {
        return res.status(400).json({ success: false, message: "Topik tidak valid" });
    }

    const message = {
        notification: { title, body },
        data: {
            ...data,
            type: "BROADCAST",
            timestamp: new Date().toISOString()
        },
        topic: targetTopic,
        android: { priority: "high", notification: { channelId: "orders" } },
        apns: { payload: { aps: { sound: "default" } } }
    };

    try {
        const response = await admin.messaging().send(message);
        res.status(200).json({ success: true, message: `Broadcast ke ${targetTopic} berhasil`, response });
    } catch (error) {
        console.error("🔥 Error broadcast:", error);
        res.status(500).json({ success: false, message: "Gagal mengirim broadcast", error: error.message });
    }
};