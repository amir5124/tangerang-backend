// /app/services/notificationService.js

const admin = require('../config/firebaseConfig');
const db = require('../config/db');

/**
 * INTI: Kirim ke satu FCM token spesifik
 * Tetap dieksport agar kompatibel dengan kode lama yang masih pakai sendPushNotification(token, ...)
 */
const sendToToken = async (targetToken, title, body, data = {}) => {
    if (!targetToken || targetToken === 'null' || targetToken === '' || targetToken === 'NO_TOKEN') {
        console.log("⚠️ Skip: No valid FCM Token.");
        return null;
    }

    try {
        const stringData = Object.keys(data).reduce((acc, key) => {
            acc[key] = String(data[key]);
            return acc;
        }, {});

        const message = {
            token: targetToken,
            notification: { title, body },
            data: stringData,
            android: {
                priority: "high",
                notification: {
                    sound: "default",
                    channelId: "orders",
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

        const response = await admin.messaging().send(message);
        console.log("🚀 Terkirim ke:", targetToken.substring(0, 15) + "...");
        return response;

    } catch (error) {
        console.error("🔥 FCM Error:", error.message);

        // ✅ Token expired/unregistered → nonaktifkan otomatis di user_devices
        if (error.code === 'messaging/registration-token-not-registered') {
            console.warn("📌 Token tidak valid, menonaktifkan di user_devices...");
            try {
                await db.query(
                    'UPDATE user_devices SET is_active = 0 WHERE fcm_token = ?',
                    [targetToken]
                );
                // Sinkron juga ke users supaya kolom fcm_token tidak stale
                await db.query(
                    'UPDATE users SET fcm_token = NULL WHERE fcm_token = ?',
                    [targetToken]
                );
                console.log("✅ Token dinonaktifkan.");
            } catch (dbErr) {
                console.error("⚠️ Gagal nonaktifkan token:", dbErr.message);
            }
        }

        throw error;
    }
};

/**
 * Kirim notifikasi ke satu user berdasarkan user_id
 * Otomatis ambil semua device aktif dari user_devices (support multi-device)
 */
const sendToUser = async (userId, title, body, data = {}) => {
    if (!userId) return;

    try {
        const [devices] = await db.query(
            'SELECT fcm_token FROM user_devices WHERE user_id = ? AND is_active = 1',
            [userId]
        );

        if (devices.length === 0) {
            console.log(`⚠️ [sendToUser] Tidak ada device aktif untuk UID: ${userId}`);
            return;
        }

        console.log(`📤 [sendToUser] Kirim ke ${devices.length} device aktif UID: ${userId}`);

        const results = await Promise.allSettled(
            devices.map(d => sendToToken(d.fcm_token, title, body, data))
        );

        results.forEach((result, i) => {
            if (result.status === 'rejected') {
                console.error(`⚠️ Gagal device ${i + 1} UID ${userId}:`, result.reason?.message);
            }
        });

    } catch (error) {
        console.error(`❌ [sendToUser] Error UID ${userId}:`, error.message);
    }
};

/**
 * Kirim notifikasi ke semua device aktif berdasarkan role
 * Contoh: sendToRole('admin', ...) → semua admin yang punya device aktif
 */
const sendToRole = async (role, title, body, data = {}) => {
    if (!role) return;

    try {
        const [devices] = await db.query(
            `SELECT ud.fcm_token FROM user_devices ud
             INNER JOIN users u ON u.id = ud.user_id
             WHERE u.role = ? AND ud.is_active = 1`,
            [role]
        );

        if (devices.length === 0) {
            console.log(`⚠️ [sendToRole] Tidak ada device aktif untuk role: ${role}`);
            return;
        }

        console.log(`📤 [sendToRole] Kirim ke ${devices.length} device aktif role: ${role}`);

        const results = await Promise.allSettled(
            devices.map(d => sendToToken(d.fcm_token, title, body, data))
        );

        results.forEach((result, i) => {
            if (result.status === 'rejected') {
                console.error(`⚠️ Gagal device ${i + 1} role ${role}:`, result.reason?.message);
            }
        });

    } catch (error) {
        console.error(`❌ [sendToRole] Error role ${role}:`, error.message);
    }
};

// Alias untuk kompatibilitas mundur — kode lama yang pakai sendPushNotification(token) tetap jalan
exports.sendPushNotification = sendToToken;
exports.sendToToken = sendToToken;
exports.sendToUser = sendToUser;
exports.sendToRole = sendToRole;