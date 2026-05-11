const admin = require('../config/firebaseConfig');
const db = require('../config/db');

// ─── 1. SEND TOPIC BROADCAST (Firebase + Database) ───
const sendTopicBroadcast = async (req, res) => {
    const { targetTopic, title, body, data } = req.body;
    const allowedTopics = ['all_mitra', 'all_customer'];

    console.log(`[Broadcast] Mencoba kirim ke topic: ${targetTopic} | Title: ${title}`);

    if (!allowedTopics.includes(targetTopic)) {
        console.warn(`[Broadcast] Gagal: Topik '${targetTopic}' tidak diizinkan.`);
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
        android: {
            priority: "high",
            notification: {
                channelId: "default",
                clickAction: "TOP_STORY_ACTIVITY",
                sound: "default"
            }
        },
        webpush: {
            notification: {
                title,
                body,
                icon: "https://res.cloudinary.com/dgsdmgcc7/image/upload/v1770989052/Salinan_LOGO_TF_1-removebg-preview_ybdbz0.png",
            },
            fcm_options: {
                link: "https://tangerangfast.netlify.app"
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
        // A. Kirim ke Firebase
        const response = await admin.messaging().send(message);
        console.log(`[Broadcast] Berhasil terkirim ke FCM! ID: ${response}`);

        // B. Simpan ke Database (Agar muncul di History Chat)
        // user_id diisi NULL karena ini pesan broadcast untuk semua
        await db.execute(
            `INSERT INTO notifications (user_id, title, message, type) VALUES (NULL, ?, ?, ?)`,
            [title, body, data?.type_category || 'info']
        );
        console.log(`[Broadcast] Berhasil disimpan ke Database.`);

        res.status(200).json({ success: true, message: "Broadcast terkirim dan disimpan" });
    } catch (error) {
        console.error(`[Broadcast] 🔥 Error:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ─── 2. SUBSCRIBE TO TOPIC ───
const subscribeToTopic = async (req, res) => {
    const { token, role } = req.body;
    const topic = role === 'mitra' ? 'all_mitra' : 'all_customer';

    console.log(`[Subscribe] Mendaftarkan token ke topic: ${topic}`);

    try {
        const response = await admin.messaging().subscribeToTopic([token], topic);
        console.log(`[Subscribe] Sukses:`, JSON.stringify(response));
        res.status(200).json({ success: true });
    } catch (error) {
        console.error(`[Subscribe] 🔥 Error:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ─── 3. GET NOTIFICATION HISTORY (Untuk ChatScreen) ───
const getNotificationHistory = async (req, res) => {
    const { user_id } = req.params;

    try {
        // Mengambil pesan personal user + pesan broadcast (user_id IS NULL)
        const [rows] = await db.execute(`
            SELECT 
                id, 
                title, 
                message, 
                type, 
                is_read, 
                created_at 
            FROM notifications 
            WHERE user_id = ? OR user_id IS NULL 
            ORDER BY created_at DESC
        `, [user_id]);

        res.status(200).json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('[getNotificationHistory] ❌', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── 4. MARK AS READ ───
const markAsRead = async (req, res) => {
    const { id } = req.params;
    try {
        await db.execute('UPDATE notifications SET is_read = 1 WHERE id = ?', [id]);
        res.status(200).json({ success: true, message: "Notifikasi telah dibaca" });
    } catch (error) {
        console.error('[markAsRead] ❌', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Pastikan semua fungsi masuk ke module.exports agar router bisa mengenalinya
module.exports = {
    sendTopicBroadcast,
    subscribeToTopic,
    getNotificationHistory,
    markAsRead
};