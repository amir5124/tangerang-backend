const admin = require('../config/firebaseConfig');

exports.sendPushNotification = async (targetToken, title, body, data = {}) => {
    if (!targetToken) {
        console.log("⚠️ Skip sending notification: No FCM Token found.");
        return;
    }

    const message = {
        token: targetToken,
        notification: {
            title: title,
            body: body,
        },
        data: data,
        // Tambahkan konfigurasi Android agar berbunyi
        android: {
            priority: "high", // Penting agar muncul seketika
            notification: {
                sound: "default",
                channelId: "orders", // Harus sama dengan di React Native
                priority: "high",
            },
        },
        // Tambahkan konfigurasi iOS agar berbunyi
        apns: {
            payload: {
                aps: {
                    sound: "default",
                },
            },
        },
    };

    try {
        const response = await admin.messaging().send(message);
        console.log("🚀 Notifikasi terkirim:", response);
        return response;
    } catch (error) {
        console.error("🔥 Gagal kirim notifikasi:", error);
        throw error;
    }
};