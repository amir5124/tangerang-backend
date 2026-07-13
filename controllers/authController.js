const admin = require('../config/firebaseConfig');
const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { sendToRole } = require('../services/notificationService');
const { OAuth2Client } = require('google-auth-library');
const { sendResetPasswordEmail } = require('../utils/mailer');
const crypto = require('crypto');
const upload = require('../middlewares/uploadMiddleware');
const multer = require('multer');

const JWT_SECRET = process.env.JWT_SECRET || 'bad750e525b96e0efaf8bf2e4daa19515a2dcf76e047f0aa28bb35eebd767a08';

const GOOGLE_CLIENT_ID_ADMIN = "206607018424-u9a7v54du628kt7mmnlcclsvq3og33ce.apps.googleusercontent.com";
const GOOGLE_CLIENT_ID_CUSTOMER = "206607018424-vpr9bdfrk6oedfcvouf5i5e3lan7ckoh.apps.googleusercontent.com";

const client = new OAuth2Client(GOOGLE_CLIENT_ID_ADMIN);

// ✅ TANPA expiresIn (sesuai permintaan)
const generateToken = (user) => {
    return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET);
};

// ─────────────────────────────────────────────
// HELPER: Deteksi device_type dari User-Agent
// ─────────────────────────────────────────────
const detectDeviceType = (userAgent = '') => {
    const ua = userAgent.toLowerCase();
    if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
    if (ua.includes('android')) return 'android';
    return 'android';
};

// ─────────────────────────────────────────────
// HELPER: Upsert FCM token dengan LOGGING LENGKAP
// ─────────────────────────────────────────────
const upsertDeviceToken = async (userId, fcmToken, userAgent = '') => {
    const tag = `[upsertDeviceToken][UID:${userId}]`;

    // LOG 1: MULAI PROSES
    console.log(`${tag} 🚀 START — Token: ${fcmToken ? fcmToken.substring(0, 30) + '...' : 'NULL'}`);
    console.log(`${tag} 📱 User-Agent: ${userAgent || 'TIDAK ADA'}`);

    // LOG 2: VALIDASI TOKEN
    if (!fcmToken) {
        console.warn(`${tag} ⚠️ TOKEN NULL — Lewati proses`);
        return { success: false, reason: 'Token is null/undefined' };
    }

    if (fcmToken === 'NO_TOKEN') {
        console.warn(`${tag} ⚠️ TOKEN = 'NO_TOKEN' — Lewati proses`);
        return { success: false, reason: 'Token is NO_TOKEN' };
    }

    if (fcmToken === 'null') {
        console.warn(`${tag} ⚠️ TOKEN = 'null' (string) — Lewati proses`);
        return { success: false, reason: 'Token is "null" string' };
    }

    if (fcmToken.trim() === '') {
        console.warn(`${tag} ⚠️ TOKEN EMPTY STRING — Lewati proses`);
        return { success: false, reason: 'Token is empty string' };
    }

    if (fcmToken.startsWith('WEB_NO_TOKEN')) {
        console.warn(`${tag} ⚠️ TOKEN starts with WEB_NO_TOKEN — Lewati proses`);
        return { success: false, reason: 'Token starts with WEB_NO_TOKEN' };
    }

    if (fcmToken === 'WEB_TOKEN') {
        console.warn(`${tag} ⚠️ TOKEN = WEB_TOKEN — Lewati proses`);
        return { success: false, reason: 'Token is WEB_TOKEN' };
    }

    // LOG 3: TOKEN VALID
    console.log(`${tag} ✅ Token VALID — Panjang: ${fcmToken.length} karakter`);

    const deviceType = detectDeviceType(userAgent);
    console.log(`${tag} 📱 Device Type: ${deviceType}`);

    try {
        // LOG 4: MULAI QUERY
        console.log(`${tag} 📝 Menonaktifkan token lama...`);

        // Nonaktifkan token LAMA milik user ini sendiri
        const [deactivateResult] = await db.query(
            'UPDATE user_devices SET is_active = 0 WHERE user_id = ? AND fcm_token != ?',
            [userId, fcmToken]
        );
        console.log(`${tag} 📝 Token lama dinonaktifkan: ${deactivateResult.affectedRows} row(s)`);

        // LOG 5: UPSERT TOKEN
        console.log(`${tag} 📝 Menyimpan token baru ke user_devices...`);

        const [upsertResult] = await db.query(`
            INSERT INTO user_devices (user_id, fcm_token, device_type, is_active, last_used_at)
            VALUES (?, ?, ?, 1, NOW())
            ON DUPLICATE KEY UPDATE
                is_active    = 1,
                device_type  = VALUES(device_type),
                last_used_at = NOW()
        `, [userId, fcmToken, deviceType]);

        console.log(`${tag} 📝 user_devices upsert: ${upsertResult.affectedRows} row(s) affected`);
        console.log(`${tag} 📝 Insert ID: ${upsertResult.insertId || 'N/A'}`);

        // LOG 6: BACKUP KE users.fcm_token
        console.log(`${tag} 📝 Backup ke users.fcm_token...`);

        const [backupResult] = await db.query(
            'UPDATE users SET fcm_token = ? WHERE id = ?',
            [fcmToken, userId]
        );
        console.log(`${tag} 📝 users.fcm_token updated: ${backupResult.affectedRows} row(s)`);

        // LOG 7: VERIFIKASI
        console.log(`${tag} 🔍 Verifikasi penyimpanan...`);
        const [verifyResult] = await db.query(
            'SELECT id, fcm_token, is_active FROM user_devices WHERE user_id = ? AND fcm_token = ?',
            [userId, fcmToken]
        );

        if (verifyResult.length > 0) {
            console.log(`${tag} ✅ VERIFIKASI BERHASIL — ID: ${verifyResult[0].id}, Active: ${verifyResult[0].is_active}`);
        } else {
            console.warn(`${tag} ⚠️ VERIFIKASI GAGAL — Token tidak ditemukan setelah insert!`);
            return { success: false, reason: 'Verification failed after insert' };
        }

        console.log(`${tag} ✅ SELESAI — SUCCESS`);
        return { success: true };

    } catch (err) {
        console.error(`${tag} ❌ ERROR:`, err.message);
        console.error(`${tag} ❌ STACK:`, err.stack);
        return { success: false, reason: err.message };
    }
};

// ─────────────────────────────────────────────
// HELPER: Kirim notifikasi ke semua admin
// ─────────────────────────────────────────────
const notifyAdminNewUser = async (fullName, role, userId) => {
    const tag = `[notifyAdminNewUser][UID:${userId}]`;
    try {
        await sendToRole(
            'admin',
            '✨ Pengguna Baru Berhasil Daftar',
            `User baru ${fullName} (${role}) telah bergabung.`,
            {
                type: 'NEW_USER',
                userId: String(userId),
                role,
                screen: '/(tabs)/profile',
            }
        );
        console.log(`${tag} ✅ Notif admin terkirim`);
    } catch (err) {
        console.error(`${tag} ❌ Gagal kirim notif admin:`, err.message);
    }
};

// ============================================================
// REGISTER (email & password) - DENGAN LOGGING LENGKAP
// ============================================================
exports.register = async (req, res) => {
    const { full_name, email, phone_number, password, role, fcm_token } = req.body;
    const tag = '[register]';

    // LOG 1: REQUEST MASUK
    console.log(`\n${tag} ========== START REGISTER ==========`);
    console.log(`${tag} 📝 Email: ${email}`);
    console.log(`${tag} 📝 Role: ${role}`);
    console.log(`${tag} 📝 FCM Token: ${fcm_token ? fcm_token.substring(0, 30) + '...' : 'NULL'}`);
    console.log(`${tag} 📝 User-Agent: ${req.headers['user-agent'] || 'TIDAK ADA'}`);

    try {
        // LOG 2: CEK DUPLIKAT
        console.log(`${tag} 🔍 Cek duplikat email/phone...`);
        const [existingUser] = await db.query(
            'SELECT id FROM users WHERE email = ? OR phone_number = ?',
            [email, phone_number]
        );
        if (existingUser.length > 0) {
            console.warn(`${tag} ⚠️ Email atau phone sudah terdaftar`);
            return res.status(400).json({ success: false, message: 'Email atau Nomor HP sudah digunakan' });
        }
        console.log(`${tag} ✅ Tidak ada duplikat`);

        // LOG 3: HASH PASSWORD
        console.log(`${tag} 🔐 Hashing password...`);
        const hashedPassword = await bcrypt.hash(password, 10);
        console.log(`${tag} ✅ Password hashed`);

        // LOG 4: INSERT USER
        console.log(`${tag} 📝 Insert user ke database...`);
        const [userResult] = await db.query(
            'INSERT INTO users (full_name, email, phone_number, password, role, profile_picture) VALUES (?, ?, ?, ?, ?, ?)',
            [full_name, email, phone_number, hashedPassword, role, null]
        );
        const userId = userResult.insertId;
        console.log(`${tag} 👤 User baru dibuat — UID: ${userId}, Role: ${role}`);

        // LOG 5: CREATE WALLET
        console.log(`${tag} 💳 Membuat wallet...`);
        await db.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0)', [userId]);
        console.log(`${tag} 💳 Wallet dibuat untuk UID: ${userId}`);

        // LOG 6: CREATE STORE (jika mitra)
        let storeId = null;
        if (role === 'mitra') {
            console.log(`${tag} 🏪 Membuat toko untuk mitra...`);
            const [storeResult] = await db.query(
                `INSERT INTO stores (user_id, store_name, category, address, latitude, longitude, approval_status, is_active)
                 VALUES (?, ?, ?, ?, 0, 0, 'pending', 0)`,
                [userId, `${full_name} Service`, 'ac', 'Alamat belum diatur']
            );
            storeId = storeResult.insertId;
            console.log(`${tag} 🏪 Toko dibuat — Store ID: ${storeId}`);
        }

        // LOG 7: SAVE DEVICE TOKEN
        console.log(`${tag} 📱 Menyimpan device token...`);
        const tokenResult = await upsertDeviceToken(userId, fcm_token, req.headers['user-agent']);
        console.log(`${tag} 📱 Hasil upsertDeviceToken:`, tokenResult);

        // LOG 8: NOTIF ADMIN
        console.log(`${tag} 📨 Mengirim notifikasi ke admin...`);
        notifyAdminNewUser(full_name, role, userId).catch((err) => {
            console.error(`${tag} ❌ Notif admin error:`, err.message);
        });

        // LOG 9: GENERATE JWT
        console.log(`${tag} 🔑 Generate JWT...`);
        const token = generateToken({ id: userId, role });
        console.log(`${tag} ✅ JWT generated`);

        // LOG 10: VERIFIKASI FINAL
        console.log(`${tag} 🔍 Verifikasi final user_devices...`);
        const [finalCheck] = await db.query(
            'SELECT * FROM user_devices WHERE user_id = ?',
            [userId]
        );
        console.log(`${tag} 🔍 user_devices setelah register: ${finalCheck.length} row(s)`);
        if (finalCheck.length > 0) {
            console.log(`${tag} 🔍 Device:`, {
                id: finalCheck[0].id,
                token_preview: finalCheck[0].fcm_token ? finalCheck[0].fcm_token.substring(0, 20) + '...' : 'NULL',
                is_active: finalCheck[0].is_active
            });
        } else {
            console.warn(`${tag} ⚠️ PERINGATAN: user_devices KOSONG untuk UID: ${userId}!`);
        }

        console.log(`${tag} ✅ Register berhasil — ${email}`);
        console.log(`${tag} ========== END REGISTER ==========\n`);

        return res.status(201).json({
            success: true,
            message: 'Registrasi berhasil',
            token,
            user: {
                id: userId,
                full_name,
                email,
                phone_number,
                role,
                profile_picture: null,
                store_id: storeId,
            },
        });

    } catch (error) {
        console.error(`${tag} ❌ ERROR FATAL:`, error.message);
        console.error(`${tag} ❌ STACK:`, error.stack);
        return res.status(500).json({
            success: false,
            message: 'Gagal register',
            error: error.message
        });
    }
};

// ============================================================
// GOOGLE AUTH (register + login via Google) - DENGAN LOGGING LENGKAP
// ============================================================
exports.googleAuth = async (req, res) => {
    const { idToken, role, fcm_token, targetRole } = req.body;
    const tag = '[googleAuth]';

    console.log(`\n${tag} ========== START GOOGLE AUTH ==========`);
    console.log(`${tag} 📝 targetRole: ${targetRole}`);
    console.log(`${tag} 📝 providedRole: ${role}`);
    console.log(`${tag} 📝 hasFcm: ${!!fcm_token}`);
    console.log(`${tag} 📝 FCM Token: ${fcm_token ? fcm_token.substring(0, 30) + '...' : 'NULL'}`);

    try {
        console.log(`${tag} 🔍 Verifikasi Google token...`);
        const ticket = await client.verifyIdToken({
            idToken,
            audience: [GOOGLE_CLIENT_ID_ADMIN, GOOGLE_CLIENT_ID_CUSTOMER],
        });
        const { email, name, picture } = ticket.getPayload();
        console.log(`${tag} ✅ Token verified — ${email}`);

        console.log(`${tag} 🔍 Cek user di database...`);
        const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        let user = rows[0];

        if (!user) {
            // ── REGISTER via Google ──────────────────────────
            console.log(`${tag} 🆕 User tidak ditemukan, proses REGISTER — ${email}`);

            const [result] = await db.query(
                'INSERT INTO users (full_name, email, phone_number, password, role, profile_picture) VALUES (?, ?, ?, ?, ?, ?)',
                [name, email, null, 'GOOGLE_AUTH', role || 'customer', picture || null]
            );
            const userId = result.insertId;
            console.log(`${tag} 👤 User baru dibuat — UID: ${userId}`);

            console.log(`${tag} 💳 Membuat wallet...`);
            await db.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0)', [userId]);
            console.log(`${tag} 💳 Wallet dibuat untuk UID: ${userId}`);

            if (role === 'mitra') {
                console.log(`${tag} 🏪 Membuat toko untuk mitra...`);
                await db.query(
                    `INSERT INTO stores (user_id, store_name, category, address, latitude, longitude, approval_status, is_active)
                     VALUES (?, ?, ?, ?, 0, 0, 'pending', 0)`,
                    [userId, `${name} Service`, 'ac', 'Alamat belum diatur']
                );
                console.log(`${tag} 🏪 Toko dibuat untuk mitra UID: ${userId}`);
            }

            console.log(`${tag} 📱 Menyimpan device token...`);
            const tokenResult = await upsertDeviceToken(userId, fcm_token, req.headers['user-agent']);
            console.log(`${tag} 📱 Hasil upsertDeviceToken:`, tokenResult);

            notifyAdminNewUser(name, role || 'customer', userId).catch(() => { });

            const [newUser] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
            user = newUser[0];

        } else {
            // ── LOGIN via Google ─────────────────────────────
            console.log(`${tag} 🔑 User ditemukan, proses LOGIN — ${email}`);

            if (targetRole && user.role !== targetRole) {
                console.warn(`${tag} 🚫 Role mismatch — akun adalah ${user.role}, dicoba sebagai ${targetRole}`);
                return res.status(403).json({
                    success: false,
                    message: `Akses Ditolak. Akun Google ini terdaftar sebagai ${user.role}.`,
                });
            }

            if (fcm_token) {
                console.log(`${tag} 📱 Update device token...`);
                const tokenResult = await upsertDeviceToken(user.id, fcm_token, req.headers['user-agent']);
                console.log(`${tag} 📱 Hasil upsertDeviceToken:`, tokenResult);
            }
        }

        let storeId = null;
        if (user.role === 'mitra') {
            const [stores] = await db.query('SELECT id FROM stores WHERE user_id = ?', [user.id]);
            storeId = stores[0]?.id || null;
        }

        console.log(`${tag} 🔑 Generate JWT...`);
        const token = generateToken(user);
        console.log(`${tag} ✅ JWT generated`);

        console.log(`${tag} 🚀 Berhasil — UID: ${user.id}`);
        console.log(`${tag} ========== END GOOGLE AUTH ==========\n`);

        return res.status(200).json({
            success: true,
            token,
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                role: user.role,
                phone_number: user.phone_number,
                profile_picture: user.profile_picture,
                store_id: storeId,
            },
        });

    } catch (error) {
        console.error(`${tag} ❌ FATAL:`, error.message);
        console.error(`${tag} ❌ STACK:`, error.stack);
        return res.status(401).json({
            success: false,
            message: 'Token Google tidak valid atau aplikasi tidak terdaftar',
            error: error.message,
        });
    }
};

// ============================================================
// LOGIN (email & password) - DENGAN LOGGING LENGKAP
// ============================================================
exports.login = async (req, res) => {
    const { email, password, fcm_token, targetRole } = req.body;
    const tag = '[login]';
    const genericError = 'Email atau Password salah';

    console.log(`\n${tag} ========== START LOGIN ==========`);
    console.log(`${tag} 📝 Email: ${email}`);
    console.log(`${tag} 📝 Target Role: ${targetRole}`);
    console.log(`${tag} 📝 FCM Token: ${fcm_token ? fcm_token.substring(0, 30) + '...' : 'NULL'}`);

    try {
        console.log(`${tag} 🔍 Mencari user...`);
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            console.warn(`${tag} ⚠️ User tidak ditemukan`);
            return res.status(401).json({ success: false, message: genericError });
        }

        const user = users[0];
        console.log(`${tag} 👤 User ditemukan — UID: ${user.id}, Role: ${user.role}`);

        console.log(`${tag} 🔐 Verifikasi password...`);
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.warn(`${tag} ⚠️ Password salah`);
            return res.status(401).json({ success: false, message: genericError });
        }
        console.log(`${tag} ✅ Password valid`);

        if (targetRole && user.role !== targetRole) {
            console.warn(`${tag} 🚫 Role mismatch — akun adalah ${user.role}, dicoba sebagai ${targetRole}`);
            return res.status(403).json({
                success: false,
                message: `Akses Ditolak. Akun Anda terdaftar sebagai ${user.role}.`,
            });
        }

        // ✅ Update device token dengan logging
        console.log(`${tag} 📱 Update device token...`);
        const tokenResult = await upsertDeviceToken(user.id, fcm_token, req.headers['user-agent']);
        console.log(`${tag} 📱 Hasil upsertDeviceToken:`, tokenResult);

        let storeData = null;
        if (user.role === 'mitra') {
            console.log(`${tag} 🏪 Ambil data store...`);
            const [stores] = await db.query('SELECT id, is_active FROM stores WHERE user_id = ?', [user.id]);
            storeData = stores[0] || null;
            console.log(`${tag} 🏪 Store ID: ${storeData ? storeData.id : 'NULL'}`);
        }

        console.log(`${tag} 🔑 Generate JWT...`);
        const token = generateToken(user);
        console.log(`${tag} ✅ JWT generated`);

        // Verifikasi final
        console.log(`${tag} 🔍 Verifikasi final user_devices...`);
        const [finalCheck] = await db.query(
            'SELECT * FROM user_devices WHERE user_id = ?',
            [user.id]
        );
        console.log(`${tag} 🔍 user_devices setelah login: ${finalCheck.length} row(s)`);

        console.log(`${tag} ✅ Login berhasil — UID: ${user.id}, Role: ${user.role}`);
        console.log(`${tag} ========== END LOGIN ==========\n`);

        return res.json({
            success: true,
            token,
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                role: user.role,
                profile_picture: user.profile_picture,
                store_id: storeData ? storeData.id : null,
                is_active: storeData ? storeData.is_active : (user.role === 'customer' ? 1 : 0),
            },
        });

    } catch (error) {
        console.error(`${tag} ❌ ERROR FATAL:`, error.message);
        console.error(`${tag} ❌ STACK:`, error.stack);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan internal' });
    }
};

// ============================================================
// LOGOUT - DENGAN LOGGING LENGKAP
// ============================================================
exports.logout = async (req, res) => {
    const userId = req.user ? req.user.id : req.body.userId;
    const { fcm_token } = req.body;
    const tag = `[logout][UID:${userId}]`;

    console.log(`\n${tag} ========== START LOGOUT ==========`);
    console.log(`${tag} 📝 FCM Token: ${fcm_token ? fcm_token.substring(0, 30) + '...' : 'NULL'}`);

    try {
        if (fcm_token) {
            console.log(`${tag} 📝 Menonaktifkan device spesifik...`);
            const [result] = await db.query(
                'UPDATE user_devices SET is_active = 0 WHERE user_id = ? AND fcm_token = ?',
                [userId, fcm_token]
            );
            console.log(`${tag} 📝 Device dinonaktifkan: ${result.affectedRows} row(s)`);
        } else {
            console.log(`${tag} 📝 Menonaktifkan SEMUA device user...`);
            const [result] = await db.query(
                'UPDATE user_devices SET is_active = 0 WHERE user_id = ?',
                [userId]
            );
            console.log(`${tag} 📝 Device dinonaktifkan: ${result.affectedRows} row(s)`);
        }

        // Cek apakah masih ada device aktif
        console.log(`${tag} 🔍 Cek device aktif tersisa...`);
        const [activeDevices] = await db.query(
            'SELECT COUNT(*) as count FROM user_devices WHERE user_id = ? AND is_active = 1',
            [userId]
        );

        if (activeDevices[0].count === 0) {
            console.log(`${tag} 🧹 Tidak ada device aktif, backup users.fcm_token di-null`);
            await db.query('UPDATE users SET fcm_token = NULL WHERE id = ?', [userId]);
        } else {
            console.log(`${tag} ℹ️ Masih ada ${activeDevices[0].count} device aktif, backup users.fcm_token dipertahankan`);
        }

        console.log(`${tag} 🚪 Logout berhasil`);
        console.log(`${tag} ========== END LOGOUT ==========\n`);
        return res.json({ success: true, message: 'Logout berhasil' });

    } catch (error) {
        console.error(`${tag} ❌ Error:`, error.message);
        console.error(`${tag} ❌ STACK:`, error.stack);
        return res.status(500).json({ success: false, error: error.message });
    }
};

// ============================================================
// UPDATE PROFILE - DENGAN LOGGING LENGKAP
// ============================================================
exports.updateProfile = async (req, res) => {
    const tag = '[updateProfile]';
    console.log(`\n${tag} ========== START UPDATE PROFILE ==========`);
    console.log(`${tag} Body:`, req.body);
    console.log(`${tag} File:`, req.file ? req.file.filename : 'TIDAK ADA FILE');

    const { user_id, full_name, email, phone_number } = req.body;

    try {
        if (!user_id) {
            console.warn(`${tag} ⚠️ User ID tidak ada`);
            return res.status(400).json({ success: false, message: 'User ID wajib ada' });
        }

        console.log(`${tag} 🔍 Cek user...`);
        const [currentUser] = await db.query('SELECT profile_picture FROM users WHERE id = ?', [user_id]);
        if (currentUser.length === 0) {
            console.warn(`${tag} ⚠️ User tidak ditemukan`);
            return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
        }

        let final_profile_picture = currentUser[0].profile_picture;
        if (req.file) {
            final_profile_picture = `/uploads/profiles/${req.file.filename}`;
            console.log(`${tag} 📸 Foto baru: ${final_profile_picture}`);
        }

        console.log(`${tag} 🔍 Cek duplikat email/phone...`);
        const [existing] = await db.query(
            'SELECT id FROM users WHERE (email = ? OR phone_number = ?) AND id != ?',
            [email, phone_number, user_id]
        );
        if (existing.length > 0) {
            console.warn(`${tag} ⚠️ Email/No HP sudah dipakai orang lain`);
            return res.status(400).json({ success: false, message: 'Email/No HP sudah dipakai orang lain' });
        }

        console.log(`${tag} 📝 Update profile...`);
        await db.query(
            'UPDATE users SET full_name = ?, email = ?, phone_number = ?, profile_picture = ? WHERE id = ?',
            [full_name, email, phone_number, final_profile_picture, user_id]
        );

        console.log(`${tag} ✅ Profile updated — UID: ${user_id}`);
        console.log(`${tag} ========== END UPDATE PROFILE ==========\n`);

        return res.json({
            success: true,
            message: 'Profil diperbarui',
            user: { id: user_id, full_name, email, phone_number, profile_picture: final_profile_picture },
        });

    } catch (error) {
        console.error(`${tag} ❌ Error:`, error.message);
        console.error(`${tag} ❌ STACK:`, error.stack);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ============================================================
// CHANGE PASSWORD - DENGAN LOGGING LENGKAP
// ============================================================
exports.changePassword = async (req, res) => {
    const { user_id, old_password, new_password } = req.body;
    const tag = `[changePassword][UID:${user_id}]`;

    console.log(`\n${tag} ========== START CHANGE PASSWORD ==========`);

    try {
        console.log(`${tag} 🔍 Cek user...`);
        const [rows] = await db.query('SELECT password FROM users WHERE id = ?', [user_id]);
        if (rows.length === 0) {
            console.warn(`${tag} ⚠️ User tidak ditemukan`);
            return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
        }

        console.log(`${tag} 🔐 Verifikasi password lama...`);
        const isMatch = await bcrypt.compare(old_password, rows[0].password);
        if (!isMatch) {
            console.warn(`${tag} ⚠️ Password lama salah`);
            return res.status(400).json({ success: false, message: 'Password lama salah' });
        }
        console.log(`${tag} ✅ Password lama valid`);

        console.log(`${tag} 🔐 Hashing password baru...`);
        const hashedPassword = await bcrypt.hash(new_password, await bcrypt.genSalt(10));

        console.log(`${tag} 📝 Update password...`);
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user_id]);

        console.log(`${tag} ✅ Password diperbarui — UID: ${user_id}`);
        console.log(`${tag} ========== END CHANGE PASSWORD ==========\n`);
        return res.json({ success: true, message: 'Password berhasil diperbarui' });

    } catch (error) {
        console.error(`${tag} ❌ Error:`, error.message);
        console.error(`${tag} ❌ STACK:`, error.stack);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================================
// GET PROFILE - DENGAN LOGGING LENGKAP
// ============================================================
exports.getProfile = async (req, res) => {
    const userId = req.user.id;
    const tag = `[getProfile][UID:${userId}]`;

    console.log(`\n${tag} ========== START GET PROFILE ==========`);

    try {
        // ✅ Ambil data user tanpa fcm_token (ambil dari user_devices)
        const [rows] = await db.query(
            `SELECT u.id, u.full_name, u.email, u.phone_number, u.role, u.profile_picture,
                    s.id AS store_id, s.is_active
             FROM users u
             LEFT JOIN stores s ON u.id = s.user_id
             WHERE u.id = ?`,
            [userId]
        );

        if (rows.length === 0) {
            console.warn(`${tag} ⚠️ User tidak ditemukan`);
            return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
        }

        const user = rows[0];

        // ✅ Ambil device aktif dari user_devices
        const [devices] = await db.query(
            'SELECT fcm_token, device_type, is_active, last_used_at FROM user_devices WHERE user_id = ? ORDER BY last_used_at DESC',
            [userId]
        );

        console.log(`${tag} ✅ Profile diambil — ${user.email}`);
        console.log(`${tag} 📱 Device aktif: ${devices.length} device(s)`);
        console.log(`${tag} ========== END GET PROFILE ==========\n`);

        return res.json({
            success: true,
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                phone_number: user.phone_number,
                role: user.role,
                profile_picture: user.profile_picture,
                store_id: user.store_id,
                is_active: user.role === 'customer' ? 1 : (user.is_active || 0),
                devices: devices
            },
        });

    } catch (error) {
        console.error(`${tag} ❌ Error:`, error.message);
        console.error(`${tag} ❌ STACK:`, error.stack);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
};

// ============================================================
// REQUEST RESET PASSWORD - DENGAN LOGGING LENGKAP
// ============================================================
exports.requestReset = async (req, res) => {
    const { email } = req.body;
    const tag = '[requestReset]';

    console.log(`\n${tag} ========== START REQUEST RESET ==========`);
    console.log(`${tag} 📝 Email: ${email}`);

    try {
        const [user] = await db.query('SELECT id, full_name FROM users WHERE email = ?', [email]);

        if (user.length === 0) {
            console.log(`${tag} ℹ️ Email tidak ditemukan (tidak bocorkan info)`);
            return res.json({ success: true, message: 'Jika email terdaftar, instruksi reset akan dikirim.' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiry = new Date(Date.now() + 3600000);

        console.log(`${tag} 📝 Simpan token reset...`);
        await db.query(
            'UPDATE users SET reset_token = ?, reset_expiry = ? WHERE email = ?',
            [resetToken, expiry, email]
        );

        console.log(`${tag} 📨 Kirim email reset...`);
        await sendResetPasswordEmail(email, user[0].full_name, resetToken);

        console.log(`${tag} ✅ Email reset terkirim ke ${email}`);
        console.log(`${tag} ========== END REQUEST RESET ==========\n`);
        return res.json({ success: true, message: 'Instruksi reset password telah dikirim ke email.' });

    } catch (error) {
        console.error(`${tag} ❌ Error:`, error.message);
        console.error(`${tag} ❌ STACK:`, error.stack);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem.' });
    }
};

// ============================================================
// RESET PASSWORD - DENGAN LOGGING LENGKAP
// ============================================================
exports.resetPassword = async (req, res) => {
    const { token, newPassword } = req.body;
    const tag = '[resetPassword]';

    console.log(`\n${tag} ========== START RESET PASSWORD ==========`);
    console.log(`${tag} 📝 Token: ${token ? token.substring(0, 20) + '...' : 'NULL'}`);

    try {
        console.log(`${tag} 🔍 Verifikasi token...`);
        const [user] = await db.query(
            'SELECT id FROM users WHERE reset_token = ? AND reset_expiry > NOW()',
            [token]
        );

        if (user.length === 0) {
            console.warn(`${tag} ⚠️ Token tidak valid atau expired`);
            return res.status(400).json({
                success: false,
                message: 'Token tidak valid atau sudah kedaluwarsa. Silakan minta link baru.',
            });
        }

        console.log(`${tag} ✅ Token valid — UID: ${user[0].id}`);

        console.log(`${tag} 🔐 Hashing password baru...`);
        const hashedPassword = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));

        console.log(`${tag} 📝 Update password...`);
        await db.query(
            'UPDATE users SET password = ?, reset_token = NULL, reset_expiry = NULL WHERE id = ?',
            [hashedPassword, user[0].id]
        );

        console.log(`${tag} ✅ Password berhasil direset untuk UID: ${user[0].id}`);
        console.log(`${tag} ========== END RESET PASSWORD ==========\n`);
        return res.json({ success: true, message: 'Password Anda berhasil diperbarui. Silakan login.' });

    } catch (error) {
        console.error(`${tag} ❌ Error:`, error.message);
        console.error(`${tag} ❌ STACK:`, error.stack);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan server saat memperbarui password.' });
    }
};

// ============================================================
// EXTRA: Get Active Device for Specific User (untuk debugging)
// ============================================================
exports.getUserDevices = async (req, res) => {
    const { userId } = req.params;
    const tag = `[getUserDevices][UID:${userId}]`;

    console.log(`\n${tag} ========== START GET USER DEVICES ==========`);

    try {
        const [devices] = await db.query(
            'SELECT * FROM user_devices WHERE user_id = ? ORDER BY is_active DESC, last_used_at DESC',
            [userId]
        );

        console.log(`${tag} ✅ Ditemukan ${devices.length} device`);
        devices.forEach((device, index) => {
            console.log(`${tag} 📱 Device #${index + 1}: ID: ${device.id}, Active: ${device.is_active}, Token: ${device.fcm_token ? device.fcm_token.substring(0, 20) + '...' : 'NULL'}`);
        });

        console.log(`${tag} ========== END GET USER DEVICES ==========\n`);
        return res.json({
            success: true,
            devices,
        });
    } catch (error) {
        console.error(`${tag} ❌ Error:`, error.message);
        console.error(`${tag} ❌ STACK:`, error.stack);
        return res.status(500).json({ success: false, error: error.message });
    }
};

// ============================================================
// EXTRA: Refresh Device Token (untuk update token tanpa login)
// ============================================================
exports.refreshDeviceToken = async (req, res) => {
    const user_id = req.user.id; // ✅ ambil dari token JWT, bukan dari body
    const { fcm_token } = req.body;
    const tag = `[refreshDeviceToken][UID:${user_id}]`;

    console.log(`\n${tag} ========== START REFRESH TOKEN ==========`);
    console.log(`${tag} 📝 User ID: ${user_id}`);
    console.log(`${tag} 📝 Token: ${fcm_token ? fcm_token.substring(0, 30) + '...' : 'NULL'}`);

    try {
        if (!user_id || !fcm_token) {
            console.warn(`${tag} ⚠️ user_id atau fcm_token kosong`);
            return res.status(400).json({
                success: false,
                message: 'user_id dan fcm_token wajib diisi'
            });
        }

        // Cek apakah user exists
        const [userCheck] = await db.query('SELECT id FROM users WHERE id = ?', [user_id]);
        if (userCheck.length === 0) {
            console.warn(`${tag} ⚠️ User tidak ditemukan`);
            return res.status(404).json({
                success: false,
                message: 'User tidak ditemukan'
            });
        }

        const result = await upsertDeviceToken(user_id, fcm_token, req.headers['user-agent']);

        if (result.success) {
            console.log(`${tag} ✅ Token berhasil di-refresh`);
            console.log(`${tag} ========== END REFRESH TOKEN ==========\n`);
            return res.json({
                success: true,
                message: 'Token berhasil diperbarui',
                data: result
            });
        } else {
            console.warn(`${tag} ⚠️ Token gagal di-refresh: ${result.reason}`);
            console.log(`${tag} ========== END REFRESH TOKEN ==========\n`);
            return res.status(500).json({
                success: false,
                message: 'Gagal refresh token',
                reason: result.reason
            });
        }

    } catch (error) {
        console.error(`${tag} ❌ Error:`, error.message);
        console.error(`${tag} ❌ STACK:`, error.stack);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};