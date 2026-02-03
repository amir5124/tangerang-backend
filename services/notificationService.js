// services/notificationService.js
const admin = process.env.FIREBASE_SERVICE_ACCOUNT;

exports.sendPushNotification = async (targetToken, title, body, data = {}) => {
    if (!targetToken) {
        console.log("⚠️ Skip sending notification: No FCM Token found.");
        return;
    }

    const message = {
        notification: {
            title: title,
            body: body,
        },
        data: data, // Opsional: untuk navigasi di app (misal { orderId: "123" })
        token: targetToken,
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