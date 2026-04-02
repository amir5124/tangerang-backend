const admin = require('../config/firebaseConfig');

exports.sendTopicBroadcast = async (req, res) => {
    const { targetTopic, title, body, data } = req.body;
    const allowedTopics = ['all_mitra', 'all_customer'];
    
    // Debug: Log request masuk
    console.log(`[Broadcast] Mencoba kirim ke topic: ${targetTopic} | Title: ${title}`);

    if (!allowedTopics.includes(targetTopic)) {
        console.warn(`[Broadcast] Gagal: Topik '${targetTopic}' tidak diizinkan.`);
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
        console.log(`[Broadcast] Mengirim payload ke Firebase...`);
        const response = await admin.messaging().send(message);
        
        // Debug: Log sukses dari Firebase
        console.log(`[Broadcast] Berhasil terkirim! Firebase ID: ${response}`);
        
        res.status(200).json({ success: true, message: "Broadcast terkirim" });
    } catch (error) {
        // Debug: Log detail error
        console.error(`[Broadcast] 🔥 Error Firebase:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.subscribeToTopic = async (req, res) => {
    const { token, role } = req.body;
    const topic = role === 'mitra' ? 'all_mitra' : 'all_customer';
    
    // Debug: Log proses subscribe
    console.log(`[Subscribe] Mendaftarkan token ke topic: ${topic}`);
    console.log(`[Subscribe] Token: ${token ? token.substring(0, 15) + "..." : "NULL"}`);

    try {
        const response = await admin.messaging().subscribeToTopic([token], topic);
        
        // Debug: Log hasil subscribe
        console.log(`[Subscribe] Sukses:`, JSON.stringify(response));
        
        res.status(200).json({ success: true });
    } catch (error) {
        // Debug: Log detail error
        console.error(`[Subscribe] 🔥 Error saat subscribe:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};