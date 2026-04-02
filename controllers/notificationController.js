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
        notification: {
            title,
            body
        },
        // Pastikan semua data di dalam 'data' adalah STRING
        data: {
            ...data,
            type: "BROADCAST",
            timestamp: new Date().toISOString()
        },
        topic: targetTopic,
        android: {
            priority: "high",
            notification: {
                channelId: "default", // <--- SESUAIKAN DENGAN FRONTEND
                clickAction: "TOP_STORY_ACTIVITY", // Membantu trigger open app
                sound: "default"
            }
        },
        webpush: {
            notification: {
                title,
                body,
                icon: "https://res.cloudinary.com/dgsdmgcc7/image/upload/v1770989052/Salinan_LOGO_TF_1-removebg-preview_ybdbz0.png", // Tambahkan icon agar muncul di Web
            },
            fcm_options: {
                link: "https://tangerangfast.netlify.app" // Klik notif di web lari ke sini
            }
        },
        apns: {
            payload: {
                aps: {
                    sound: "default",
                    badge: 1
                }
            }
        }
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