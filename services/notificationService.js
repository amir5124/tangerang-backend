// /app/services/notificationService.js

// Import instance admin dari konfigurasi Firebase kamu
const admin = require('../config/firebaseConfig');

/**
 * Fungsi untuk mengirim push notification via Firebase Cloud Messaging (FCM)
 * @param {string} targetToken - FCM Token perangkat tujuan
 * @param {string} title - Judul notifikasi
 * @param {string} body - Isi pesan notifikasi
 * @param {object} data - Data tambahan (optional), otomatis diconvert ke string
 */
exports.sendPushNotification = async (targetToken, title, body, data = {}) => {
    // 1. Validasi keberadaan token
    if (!targetToken || targetToken === 'null' || targetToken === '') {
        console.log("⚠️ Skip sending notification: No valid FCM Token found.");
        return null;
    }

    try {
        // 2. FCM hanya menerima value berupa STRING di dalam objek data
        const stringData = Object.keys(data).reduce((acc, key) => {
            acc[key] = String(data[key]);
            return acc;
        }, {});

        // 3. Susun payload pesan
        const message = {
            token: targetToken,
            notification: {
                title: title,
                body: body,
            },
            data: stringData, 
            android: {
                priority: "high",
                notification: {
                    sound: "default",
                    channelId: "orders", // Pastikan ID ini sama dengan yang di-create di frontend (Expo/RN)
                    priority: "high",
                    clickAction: "TOP_STORY_ACTIVITY", 
                },
            },
            apns: {
                payload: {
                    aps: {
                        sound: "default",
                        contentAvailable: true,
                    },
                },
            },
        };

        // 4. Kirim notifikasi menggunakan instance admin
        const response = await admin.messaging().send(message);
        
        console.log("🚀 Notifikasi terkirim ke:", targetToken.substring(0, 10) + "...");
        return response;

    } catch (error) {
        // Log error lebih detail jika terjadi kegagalan pada SDK
        console.error("🔥 FCM Error Details:", error.message);
        
        // Cek jika error karena token sudah tidak valid (expired/unregistered)
        if (error.code === 'messaging/registration-token-not-registered') {
            console.warn("📌 Info: Token sudah tidak valid, pertimbangkan untuk menghapusnya dari database.");
        }
        
        throw error;
    }
};