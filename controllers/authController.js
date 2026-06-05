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

// ─────────────────────────────────────────────
// HELPER: Generate JWT token
// ─────────────────────────────────────────────
const generateToken = (user) => {
    return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
};

// ─────────────────────────────────────────────
// HELPER: Deteksi device_type dari User-Agent
// ─────────────────────────────────────────────
const detectDeviceType = (userAgent = '') => {
    const ua = userAgent.toLowerCase();
    if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
    if (ua.includes('android')) return 'android';
    return 'android'; // default fallback
};

// ─────────────────────────────────────────────
// HELPER: Upsert FCM token ke tabel users + user_devices
// - Nonaktifkan token lama jika token baru berbeda
// - ON DUPLICATE KEY supaya tidak ada duplikat row
// ─────────────────────────────────────────────
const upsertDeviceToken = async (userId, fcmToken, userAgent = '') => {
    if (!fcmToken || fcmToken === 'NO_TOKEN' || fcmToken === 'null' ||
        fcmToken.trim() === '' || fcmToken.startsWith('WEB_NO_TOKEN')) return;

    const deviceType = detectDeviceType(userAgent);

    try {
        await db.query('UPDATE users SET fcm_token = ? WHERE id = ?', [fcmToken, userId]);

        // ✅ TAMBAHAN — nonaktifkan token ini jika dipakai user lain (ganti akun)
        await db.query(
            'UPDATE user_devices SET is_active = 0 WHERE fcm_token = ? AND user_id != ?',
            [fcmToken, userId]
        );

        // Nonaktifkan token lama milik user ini
        await db.query(
            'UPDATE user_devices SET is_active = 0 WHERE user_id = ? AND fcm_token != ?',
            [userId, fcmToken]
        );

        // Upsert token baru
        await db.query(`
            INSERT INTO user_devices (user_id, fcm_token, device_type, is_active, last_used_at)
            VALUES (?, ?, ?, 1, NOW())
            ON DUPLICATE KEY UPDATE
                is_active    = 1,
                device_type  = VALUES(device_type),
                last_used_at = NOW()
        `, [userId, fcmToken, deviceType]);

        console.log(`📱 [upsertDeviceToken] UID: ${userId} | Type: ${deviceType} — OK`);
    } catch (err) {
        console.error(`⚠️ [upsertDeviceToken Error] UID: ${userId}:`, err.message);
    }
};
// ─────────────────────────────────────────────
// HELPER: Kirim notifikasi ke semua admin
// Menggunakan sendToRole supaya tidak bergantung
// pada fcm_token kolom users (memakai user_devices)
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
// REGISTER (email & password)
// ============================================================
exports.register = async (req, res) => {
    const { full_name, email, phone_number, password, role, fcm_token } = req.body;
    const tag = '[register]';

    try {
        // Cek duplikat email / no HP
        const [existingUser] = await db.query(
            'SELECT id FROM users WHERE email = ? OR phone_number = ?',
            [email, phone_number]
        );
        if (existingUser.length > 0) {
            return res.status(400).json({ success: false, message: 'Email atau Nomor HP sudah digunakan' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [userResult] = await db.query(
            'INSERT INTO users (full_name, email, phone_number, password, role, fcm_token, profile_picture) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [full_name, email, phone_number, hashedPassword, role, fcm_token || null, null]
        );
        const userId = userResult.insertId;
        console.log(`${tag} 👤 User baru dibuat — UID: ${userId}, Role: ${role}`);

        // Buat wallet untuk semua role
        await db.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0)', [userId]);
        console.log(`${tag} 💳 Wallet dibuat untuk UID: ${userId}`);

        // Buat toko jika mitra
        let storeId = null;
        if (role === 'mitra') {
            const [storeResult] = await db.query(
                `INSERT INTO stores (user_id, store_name, category, address, latitude, longitude, approval_status, is_active)
                 VALUES (?, ?, ?, ?, 0, 0, 'pending', 0)`,
                [userId, `${full_name} Service`, 'ac', 'Alamat belum diatur']
            );
            storeId = storeResult.insertId;
            console.log(`${tag} 🏪 Toko dibuat — Store ID: ${storeId}`);
        }

        // Simpan device token
        await upsertDeviceToken(userId, fcm_token, req.headers['user-agent']);

        // Notif ke admin (fire-and-forget, tidak block response)
        notifyAdminNewUser(full_name, role, userId).catch(() => { });

        const token = generateToken({ id: userId, role });

        console.log(`${tag} ✅ Register berhasil — ${email}`);
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
        console.error(`${tag} ❌ Error:`, error.message);
        return res.status(500).json({ success: false, message: 'Gagal register', error: error.message });
    }
};

// ============================================================
// GOOGLE AUTH (register + login via Google)
// ============================================================
exports.googleAuth = async (req, res) => {
    const { idToken, role, fcm_token, targetRole } = req.body;
    const tag = '[googleAuth]';

    console.log(`${tag} 🔍 Incoming — targetRole: ${targetRole}, providedRole: ${role}, hasFcm: ${!!fcm_token}`);

    try {
        // Verifikasi Google ID token
        const ticket = await client.verifyIdToken({
            idToken,
            audience: [GOOGLE_CLIENT_ID_ADMIN, GOOGLE_CLIENT_ID_CUSTOMER],
        });
        const { email, name, picture } = ticket.getPayload();
        console.log(`${tag} ✅ Token verified — ${email}`);

        const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        let user = rows[0];

        if (!user) {
            // ── REGISTER via Google ──────────────────────────
            console.log(`${tag} 🆕 User tidak ditemukan, proses REGISTER — ${email}`);

            const [result] = await db.query(
                'INSERT INTO users (full_name, email, phone_number, password, role, fcm_token, profile_picture) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [name, email, null, 'GOOGLE_AUTH', role || 'customer', fcm_token || null, picture || null]
            );
            const userId = result.insertId;
            console.log(`${tag} 👤 User baru dibuat — UID: ${userId}`);

            // Buat wallet
            await db.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0)', [userId]);
            console.log(`${tag} 💳 Wallet dibuat untuk UID: ${userId}`);

            // Buat toko jika mitra
            if (role === 'mitra') {
                await db.query(
                    `INSERT INTO stores (user_id, store_name, category, address, latitude, longitude, approval_status, is_active)
                     VALUES (?, ?, ?, ?, 0, 0, 'pending', 0)`,
                    [userId, `${name} Service`, 'ac', 'Alamat belum diatur']
                );
                console.log(`${tag} 🏪 Toko dibuat untuk mitra UID: ${userId}`);
            }

            // Simpan device token
            await upsertDeviceToken(userId, fcm_token, req.headers['user-agent']);

            // ✅ Notif admin — sama seperti register biasa
            notifyAdminNewUser(name, role || 'customer', userId).catch(() => { });

            // Ambil data user lengkap
            const [newUser] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
            user = newUser[0];

        } else {
            // ── LOGIN via Google ─────────────────────────────
            console.log(`${tag} 🔑 User ditemukan, proses LOGIN — ${email}`);

            // Cek role mismatch
            if (targetRole && user.role !== targetRole) {
                console.warn(`${tag} 🚫 Role mismatch — akun adalah ${user.role}, dicoba sebagai ${targetRole}`);
                return res.status(403).json({
                    success: false,
                    message: `Akses Ditolak. Akun Google ini terdaftar sebagai ${user.role}.`,
                });
            }

            // Update device token jika ada
            if (fcm_token) {
                await upsertDeviceToken(user.id, fcm_token, req.headers['user-agent']);
            }
        }

        // Ambil store_id jika mitra
        let storeId = null;
        if (user.role === 'mitra') {
            const [stores] = await db.query('SELECT id FROM stores WHERE user_id = ?', [user.id]);
            storeId = stores[0]?.id || null;
        }

        const token = generateToken(user);
        console.log(`${tag} 🚀 Berhasil — UID: ${user.id}`);

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
        return res.status(401).json({
            success: false,
            message: 'Token Google tidak valid atau aplikasi tidak terdaftar',
            error: error.message,
        });
    }
};

// ============================================================
// LOGIN (email & password)
// ============================================================
exports.login = async (req, res) => {
    const { email, password, fcm_token, targetRole } = req.body;
    const tag = '[login]';
    const genericError = 'Email atau Password salah';

    try {
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(401).json({ success: false, message: genericError });
        }

        const user = users[0];

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: genericError });
        }

        // Cek role mismatch
        if (targetRole && user.role !== targetRole) {
            console.warn(`${tag} 🚫 Role mismatch UID: ${user.id} — mencoba login sebagai ${targetRole}`);
            return res.status(403).json({
                success: false,
                message: `Akses Ditolak. Akun Anda terdaftar sebagai ${user.role}.`,
            });
        }

        // Update device token
        await upsertDeviceToken(user.id, fcm_token, req.headers['user-agent']);

        let storeData = null;
        if (user.role === 'mitra') {
            const [stores] = await db.query('SELECT id, is_active FROM stores WHERE user_id = ?', [user.id]);
            storeData = stores[0] || null;
        }

        const token = generateToken(user);
        console.log(`${tag} ✅ Login berhasil — UID: ${user.id}, Role: ${user.role}`);

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
        console.error(`${tag} ❌ Fatal:`, error.message);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan internal' });
    }
};

// ============================================================
// LOGOUT
// ============================================================
exports.logout = async (req, res) => {
    const userId = req.user ? req.user.id : req.body.userId;
    const tag = `[logout][UID:${userId}]`;

    try {
        // Hapus fcm_token dari tabel users
        await db.query('UPDATE users SET fcm_token = NULL WHERE id = ?', [userId]);

        // Nonaktifkan semua device user ini
        await db.query('UPDATE user_devices SET is_active = 0 WHERE user_id = ?', [userId]);

        console.log(`${tag} 🚪 Logout berhasil`);
        return res.json({ success: true, message: 'Logout berhasil' });

    } catch (error) {
        console.error(`${tag} ❌ Error:`, error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
};

// ============================================================
// UPDATE PROFILE
// ============================================================
exports.updateProfile = async (req, res) => {
    const tag = '[updateProfile]';
    console.log(`\n${tag} ========== DEBUG ==========`);
    console.log(`${tag} Body:`, req.body);
    console.log(`${tag} File:`, req.file ? req.file.filename : 'TIDAK ADA FILE');

    const { user_id, full_name, email, phone_number } = req.body;

    try {
        if (!user_id) {
            return res.status(400).json({ success: false, message: 'User ID wajib ada' });
        }

        const [currentUser] = await db.query('SELECT profile_picture FROM users WHERE id = ?', [user_id]);
        if (currentUser.length === 0) {
            return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
        }

        let final_profile_picture = currentUser[0].profile_picture;
        if (req.file) {
            final_profile_picture = `/uploads/profiles/${req.file.filename}`;
            console.log(`${tag} 📸 Foto baru: ${final_profile_picture}`);
        }

        const [existing] = await db.query(
            'SELECT id FROM users WHERE (email = ? OR phone_number = ?) AND id != ?',
            [email, phone_number, user_id]
        );
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'Email/No HP sudah dipakai orang lain' });
        }

        await db.query(
            'UPDATE users SET full_name = ?, email = ?, phone_number = ?, profile_picture = ? WHERE id = ?',
            [full_name, email, phone_number, final_profile_picture, user_id]
        );

        return res.json({
            success: true,
            message: 'Profil diperbarui',
            user: { id: user_id, full_name, email, phone_number, profile_picture: final_profile_picture },
        });

    } catch (error) {
        console.error(`${tag} ❌ Error:`, error.message);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ============================================================
// CHANGE PASSWORD
// ============================================================
exports.changePassword = async (req, res) => {
    const { user_id, old_password, new_password } = req.body;
    const tag = `[changePassword][UID:${user_id}]`;

    try {
        const [rows] = await db.query('SELECT password FROM users WHERE id = ?', [user_id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
        }

        const isMatch = await bcrypt.compare(old_password, rows[0].password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: 'Password lama salah' });
        }

        const hashedPassword = await bcrypt.hash(new_password, await bcrypt.genSalt(10));
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user_id]);

        console.log(`${tag} ✅ Password diperbarui`);
        return res.json({ success: true, message: 'Password berhasil diperbarui' });

    } catch (error) {
        console.error(`${tag} ❌ Error:`, error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================================
// GET PROFILE
// ============================================================
exports.getProfile = async (req, res) => {
    const userId = req.user.id;
    const tag = `[getProfile][UID:${userId}]`;

    try {
        const [rows] = await db.query(
            `SELECT u.id, u.full_name, u.email, u.phone_number, u.role, u.fcm_token, u.profile_picture,
                    s.id AS store_id, s.is_active
             FROM users u
             LEFT JOIN stores s ON u.id = s.user_id
             WHERE u.id = ?`,
            [userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
        }

        const user = rows[0];
        console.log(`${tag} ✅ Profile diambil — ${user.email}`);

        return res.json({
            success: true,
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                phone_number: user.phone_number,
                role: user.role,
                fcm_token: user.fcm_token,
                profile_picture: user.profile_picture,
                store_id: user.store_id,
                is_active: user.role === 'customer' ? 1 : (user.is_active || 0),
            },
        });

    } catch (error) {
        console.error(`${tag} ❌ Error:`, error.message);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
};

// ============================================================
// REQUEST RESET PASSWORD
// ============================================================
exports.requestReset = async (req, res) => {
    const { email } = req.body;
    const tag = '[requestReset]';

    try {
        const [user] = await db.query('SELECT id, full_name FROM users WHERE email = ?', [email]);

        // Selalu response sama — tidak bocorkan info email terdaftar atau tidak
        if (user.length === 0) {
            return res.json({ success: true, message: 'Jika email terdaftar, instruksi reset akan dikirim.' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expiry = new Date(Date.now() + 3600000); // 1 jam

        await db.query(
            'UPDATE users SET reset_token = ?, reset_expiry = ? WHERE email = ?',
            [token, expiry, email]
        );

        await sendResetPasswordEmail(email, user[0].full_name, token);

        console.log(`${tag} ✅ Email reset terkirim ke ${email}`);
        return res.json({ success: true, message: 'Instruksi reset password telah dikirim ke email.' });

    } catch (error) {
        console.error(`${tag} ❌ Error:`, error.message);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem.' });
    }
};

// ============================================================
// RESET PASSWORD
// ============================================================
exports.resetPassword = async (req, res) => {
    const { token, newPassword } = req.body;
    const tag = '[resetPassword]';

    try {
        const [user] = await db.query(
            'SELECT id FROM users WHERE reset_token = ? AND reset_expiry > NOW()',
            [token]
        );

        if (user.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Token tidak valid atau sudah kedaluwarsa. Silakan minta link baru.',
            });
        }

        const hashedPassword = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));

        await db.query(
            'UPDATE users SET password = ?, reset_token = NULL, reset_expiry = NULL WHERE id = ?',
            [hashedPassword, user[0].id]
        );

        console.log(`${tag} ✅ Password berhasil direset untuk UID: ${user[0].id}`);
        return res.json({ success: true, message: 'Password Anda berhasil diperbarui. Silakan login.' });

    } catch (error) {
        console.error(`${tag} ❌ Error:`, error.message);
        return res.status(500).json({ success: false, message: 'Terjadi kesalahan server saat memperbarui password.' });
    }
};