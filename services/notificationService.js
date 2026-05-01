exports.sendPushNotification = async (targetToken, title, body, data = {}) => {
    if (!targetToken) {
        console.log("⚠️ Skip sending notification: No FCM Token found.");
        return;
    }

    // Pastikan semua value di dalam data adalah STRING
    const stringData = Object.keys(data).reduce((acc, key) => {
        acc[key] = String(data[key]);
        return acc;
    }, {});

    const message = {
        token: targetToken,
        notification: {
            title: title,
            body: body,
        },
        data: stringData, // Menggunakan data yang sudah diconvert ke string
        android: {
            priority: "high",
            notification: {
                sound: "default",
                channelId: "orders", // Pastikan channel 'orders' sudah dibuat di React Native
                priority: "high",
                clickAction: "TOP_STORY_ACTIVITY", // Opsional: membantu beberapa OS Android
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

    try {
        const response = await admin.messaging().send(message);
        console.log("🚀 Notifikasi terkirim:", response);
        return response;
    } catch (error) {
        console.error("🔥 Gagal kirim notifikasi:", error);
        throw error;
    }
};