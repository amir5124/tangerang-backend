// /app/services/notificationService.js
// ============================================================
// FCM Notification Service — Final Version
// Support: Expo React Native (Android & iOS)
// Fix: double notif, cold start tap, detailed logging
// ============================================================

const admin = require('../config/firebaseConfig');
const db = require('../config/db');

// ─────────────────────────────────────────────
// HELPER: format token untuk log (aman)
// ─────────────────────────────────────────────
const shortToken = (token) =>
    token ? `${token.substring(0, 20)}...${token.slice(-6)}` : 'NULL';

// ─────────────────────────────────────────────
// INTI: Kirim ke satu FCM token spesifik
// ─────────────────────────────────────────────
const sendToToken = async (targetToken, title, body, data = {}) => {
    const tag = '[sendToToken]';

    if (
        !targetToken ||
        targetToken === 'null' ||
        targetToken === '' ||
        targetToken === 'NO_TOKEN' ||
        targetToken === 'undefined'
    ) {
        console.log(`${tag} ⚠️  Skip — token tidak valid: "${targetToken}"`);
        return null;
    }

    console.log(`${tag} 📦 Mempersiapkan pesan...`);
    console.log(`${tag}    Token   : ${shortToken(targetToken)}`);
    console.log(`${tag}    Title   : ${title}`);
    console.log(`${tag}    Body    : ${body}`);
    console.log(`${tag}    Data    : ${JSON.stringify(data)}`);

    try {
        const stringData = Object.keys(data).reduce((acc, key) => {
            acc[key] = String(data[key]);
            return acc;
        }, {});

        // click_action untuk Expo supaya tap notif saat app killed/background
        // bisa di-handle di getInitialMessage() dan onMessageOpenedApp()
        stringData['click_action'] = 'FLUTTER_NOTIFICATION_CLICK';

        const message = {
            token: targetToken,
            notification: { title, body },
            data: stringData,
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: 'orders',
                    priority: 'high',
                    // ❌ DIHAPUS: clickAction: "TOP_STORY_ACTIVITY"
                    //    Itu nama Activity Android native, tidak berlaku di Expo.
                    //    Expo pakai data.click_action di atas.
                },
            },
            apns: {
                headers: {
                    'apns-priority': '10',
                },
                payload: {
                    aps: {
                        sound: 'default',
                        contentAvailable: true,
                        badge: 1,
                    },
                },
            },
        };

        const response = await admin.messaging().send(message);
        console.log(`${tag} ✅ Berhasil — messageId: ${response}`);
        console.log(`${tag}    Token : ${shortToken(targetToken)}`);
        return response;

    } catch (error) {
        console.error(`${tag} 🔥 FCM Error — code: ${error.code}`);
        console.error(`${tag}    Message : ${error.message}`);
        console.error(`${tag}    Token   : ${shortToken(targetToken)}`);

        if (error.code === 'messaging/registration-token-not-registered') {
            console.warn(`${tag} 🗑️  Token tidak terdaftar, menonaktifkan di DB...`);
            try {
                const [r1] = await db.query(
                    'UPDATE user_devices SET is_active = 0 WHERE fcm_token = ?',
                    [targetToken]
                );
                const [r2] = await db.query(
                    'UPDATE users SET fcm_token = NULL WHERE fcm_token = ?',
                    [targetToken]
                );
                console.log(`${tag} ✅ Token dinonaktifkan — user_devices: ${r1.affectedRows} baris, users: ${r2.affectedRows} baris`);
            } catch (dbErr) {
                console.error(`${tag} ⚠️  Gagal nonaktifkan token di DB:`, dbErr.message);
            }
        }

        throw error;
    }
};

// ─────────────────────────────────────────────
// Kirim ke SATU USER berdasarkan user_id
// ─────────────────────────────────────────────
const sendToUser = async (userId, title, body, data = {}) => {
    const tag = `[sendToUser][UID:${userId}]`;

    if (!userId) {
        console.warn(`${tag} ⚠️  userId kosong, skip.`);
        return;
    }

    console.log(`${tag} 🔍 Mengambil device aktif dari user_devices...`);

    try {
        const [devices] = await db.query(
            `SELECT id, fcm_token FROM user_devices 
             WHERE user_id = ? AND is_active = 1`,
            [userId]
        );

        console.log(`${tag} 📱 Ditemukan ${devices.length} device aktif`);

        if (devices.length === 0) {
            console.log(`${tag} ⚠️  Tidak ada device aktif, notif tidak terkirim.`);
            return;
        }

        const results = await Promise.allSettled(
            devices.map((d) => sendToToken(d.fcm_token, title, body, data))
        );

        let sukses = 0, gagal = 0;
        results.forEach((result, i) => {
            if (result.status === 'fulfilled') {
                sukses++;
                console.log(`${tag} ✅ Device #${i + 1} (row_id:${devices[i].id}) — OK`);
            } else {
                gagal++;
                console.error(`${tag} ❌ Device #${i + 1} (row_id:${devices[i].id}) — GAGAL: ${result.reason?.message}`);
            }
        });

        console.log(`${tag} 📊 Ringkasan: ${sukses} sukses, ${gagal} gagal dari ${devices.length} device`);

    } catch (error) {
        console.error(`${tag} ❌ Error query DB:`, error.message);
    }
};

// ─────────────────────────────────────────────
// Kirim ke SEMUA USER dengan role tertentu
// HANYA dari user_devices — bukan users.fcm_token
// ─────────────────────────────────────────────
const sendToRole = async (role, title, body, data = {}) => {
    const tag = `[sendToRole][role:${role}]`;

    if (!role) {
        console.warn(`${tag} ⚠️  role kosong, skip.`);
        return;
    }

    console.log(`${tag} 🔍 Mengambil semua device aktif untuk role "${role}"...`);

    try {
        const [devices] = await db.query(
            `SELECT ud.id, ud.fcm_token, ud.user_id
             FROM user_devices ud
             INNER JOIN users u ON u.id = ud.user_id
             WHERE u.role = ? AND ud.is_active = 1`,
            [role]
        );

        console.log(`${tag} 📱 Ditemukan ${devices.length} device aktif`);

        if (devices.length === 0) {
            console.log(`${tag} ⚠️  Tidak ada device aktif untuk role "${role}".`);
            return;
        }

        const uniqueUsers = [...new Set(devices.map((d) => d.user_id))];
        console.log(`${tag} 👥 Target user IDs: [${uniqueUsers.join(', ')}]`);

        const results = await Promise.allSettled(
            devices.map((d) => sendToToken(d.fcm_token, title, body, data))
        );

        let sukses = 0, gagal = 0;
        results.forEach((result, i) => {
            if (result.status === 'fulfilled') {
                sukses++;
                console.log(`${tag} ✅ Device #${i + 1} UID:${devices[i].user_id} — OK`);
            } else {
                gagal++;
                console.error(`${tag} ❌ Device #${i + 1} UID:${devices[i].user_id} — GAGAL: ${result.reason?.message}`);
            }
        });

        console.log(`${tag} 📊 Ringkasan: ${sukses} sukses, ${gagal} gagal dari ${devices.length} device`);

    } catch (error) {
        console.error(`${tag} ❌ Error query DB:`, error.message);
    }
};

exports.sendPushNotification = sendToToken;  // backward compat
exports.sendToToken = sendToToken;
exports.sendToUser = sendToUser;
exports.sendToRole = sendToRole;