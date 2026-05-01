const admin = require('../config/firebaseConfig');
const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { sendPushNotification } = require('../services/notificationService');
const { OAuth2Client } = require('google-auth-library');
const { sendResetPasswordEmail } = require('../utils/mailer');
const crypto = require('crypto');
const upload = require('../middlewares/uploadMiddleware'); 
const multer = require('multer');

const JWT_SECRET = process.env.JWT_SECRET || 'bad750e525b96e0efaf8bf2e4daa19515a2dcf76e047f0aa28bb35eebd767a08';

const GOOGLE_CLIENT_ID_ADMIN = "206607018424-u9a7v54du628kt7mmnlcclsvq3og33ce.apps.googleusercontent.com";
const GOOGLE_CLIENT_ID_CUSTOMER = "206607018424-vpr9bdfrk6oedfcvouf5i5e3lan7ckoh.apps.googleusercontent.com";

const client = new OAuth2Client(GOOGLE_CLIENT_ID_ADMIN);

const generateToken = (user) => {
    return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
};

exports.register = async (req, res) => {
    const { full_name, email, phone_number, password, role, fcm_token } = req.body;

    try {
        const [existingUser] = await db.query(
            'SELECT id FROM users WHERE email = ? OR phone_number = ?',
            [email, phone_number]
        );

        if (existingUser.length > 0) {
            return res.status(400).json({ success: false, message: "Email atau Nomor HP sudah digunakan" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [userResult] = await db.query(
            'INSERT INTO users (full_name, email, phone_number, password, role, fcm_token, profile_picture) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [full_name, email, phone_number, hashedPassword, role, fcm_token || null, null]
        );

        const userId = userResult.insertId;
        let storeId = null;

        // --- PEMBUATAN WALLET UNTUK SEMUA ROLE ---
        await db.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0)', [userId]);
        console.log(`💳 [Wallet Created] Wallet otomatis dibuat untuk UID: ${userId}`);

        if (role === 'mitra') {
            const [storeResult] = await db.query(
                `INSERT INTO stores (user_id, store_name, category, address, latitude, longitude, approval_status, is_active) 
                 VALUES (?, ?, ?, ?, 0, 0, 'pending', 0)`,
                [userId, `${full_name} Service`, 'ac', 'Alamat belum diatur']
            );
            storeId = storeResult.insertId;
            // Baris wallet di sini dihapus karena sudah dipindah ke atas agar global
        }

        const token = jwt.sign({ id: userId, role: role }, JWT_SECRET, { expiresIn: '30d' });

        try {
            const [admins] = await db.query(
                "SELECT fcm_token FROM users WHERE role = 'admin' AND fcm_token IS NOT NULL"
            );

            if (admins.length > 0) {
                const title = "Pengguna Baru Berhasil Daftar";
                const body = `User baru ${full_name} (${role}) telah bergabung.`;

                for (const admin of admins) {
                    await sendPushNotification(admin.fcm_token, title, body, {
                        type: "NEW_USER_REGISTERED",
                        userId: String(userId),
                        role: role,
                        screen: "/(tabs)/profile",
                    });
                }
            }
        } catch (fcmErr) {
            console.error("⚠️ FCM Admin (Register) Error Detail:", fcmErr);
        }

        console.log(`✨ [Register Success] User: ${email}, Role: ${role}`);

        res.status(201).json({
            success: true,
            message: "Registrasi berhasil",
            token,
            user: {
                id: userId,
                full_name,
                email,
                phone_number,
                role,
                profile_picture: null,
                store_id: storeId
            }
        });

    } catch (error) {
        console.error("❌ Register Error:", error.message);
        res.status(500).json({ success: false, message: "Gagal register", error: error.message });
    }
};

exports.googleAuth = async (req, res) => {
    const { idToken, role, fcm_token, targetRole } = req.body;

    console.log("🔍 [DEBUG GOOGLE] Incoming Request:", { targetRole, providedRole: role, hasFcmToken: !!fcm_token });

    try {
        const ticket = await client.verifyIdToken({
            idToken: idToken,
            audience: [GOOGLE_CLIENT_ID_ADMIN, GOOGLE_CLIENT_ID_CUSTOMER],
        });

        const payload = ticket.getPayload();
        const { email, name, picture } = payload;

        console.log(`🔍 [DEBUG GOOGLE] Token Verified. Email: ${email}, Name: ${name}`);

        const [rows] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
        let user = rows[0];

        if (!user) {
            console.log(`🆕 [DEBUG GOOGLE] User ${email} tidak ditemukan. Memulai proses REGISTER.`);

            const [result] = await db.query(
                "INSERT INTO users (full_name, email, phone_number, password, role, fcm_token, profile_picture) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [name, email, null, 'GOOGLE_AUTH', role || 'customer', fcm_token || null, picture || null]
            );

            const userId = result.insertId;
            console.log(`✅ [DEBUG GOOGLE] User baru berhasil dibuat. UID: ${userId}`);

            // --- PEMBUATAN WALLET UNTUK SEMUA USER BARU VIA GOOGLE ---
            await db.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0)', [userId]);
            console.log(`💳 [DEBUG GOOGLE] Wallet otomatis dibuat untuk UID: ${userId}`);

            if (role === 'mitra') {
                console.log(`🏪 [DEBUG GOOGLE] Inisialisasi toko untuk mitra UID: ${userId}`);
                await db.query(
                    `INSERT INTO stores (user_id, store_name, category, address, latitude, longitude, approval_status, is_active) 
                     VALUES (?, ?, ?, ?, 0, 0, 'pending', 0)`,
                    [userId, `${name} Service`, 'ac', 'Alamat belum diatur']
                );
                // Baris wallet di sini dihapus karena sudah dipindah ke atas agar global
            }

            const [newUser] = await db.query("SELECT * FROM users WHERE id = ?", [userId]);
            user = newUser[0];
        } else {
            console.log(`🔑 [DEBUG GOOGLE] User ${email} ditemukan. Memulai proses LOGIN.`);

            if (targetRole && user.role !== targetRole) {
                console.warn(`🚫 [DEBUG GOOGLE] Role Mismatch for ${email}. Access Blocked.`);
                return res.status(403).json({
                    success: false,
                    message: `Akses Ditolak. Akun Google ini terdaftar sebagai ${user.role}.`
                });
            }

            if (fcm_token) {
                console.log(`📱 [DEBUG GOOGLE] Updating FCM Token for UID: ${user.id}`);
                await db.query("UPDATE users SET fcm_token = ? WHERE id = ?", [fcm_token, user.id]);
            }
        }

        let storeId = null;
        if (user.role === 'mitra') {
            const [stores] = await db.query('SELECT id FROM stores WHERE user_id = ?', [user.id]);
            storeId = stores[0]?.id || null;
            console.log(`🏪 [DEBUG GOOGLE] Store ID ditemukan: ${storeId}`);
        }

        const token = generateToken(user);
        console.log(`🚀 [DEBUG GOOGLE] Login Success. Sending response for UID: ${user.id}`);

        res.status(200).json({
            success: true,
            token,
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                role: user.role,
                phone_number: user.phone_number,
                profile_picture: user.profile_picture,
                store_id: storeId
            }
        });

    } catch (error) {
        console.error("❌ [DEBUG GOOGLE] FATAL ERROR:", error.message);
        res.status(401).json({
            success: false,
            message: "Token Google tidak valid atau aplikasi tidak terdaftar",
            error: error.message
        });
    }
};

exports.login = async (req, res) => {
    const { email, password, fcm_token, targetRole } = req.body;
    const genericError = "Email atau Password salah";

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

        if (targetRole && user.role !== targetRole) {
            console.warn(`🚫 [Role Mismatch] UID ${user.id} mencoba masuk sebagai ${targetRole}`);
            return res.status(403).json({
                success: false,
                message: `Akses Ditolak. Akun Anda terdaftar sebagai ${user.role}.`
            });
        }

        const isValidFCM = fcm_token && fcm_token !== 'null' && fcm_token.trim() !== '';
        if (isValidFCM && fcm_token !== user.fcm_token) {
            await db.query('UPDATE users SET fcm_token = ? WHERE id = ?', [fcm_token, user.id]);
            console.log(`📱 [FCM Updated] UID: ${user.id}`);
        }

        let storeData = null;
        if (user.role === 'mitra') {
            const [stores] = await db.query('SELECT id, is_active FROM stores WHERE user_id = ?', [user.id]);
            storeData = stores[0] || null;
        }

        const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                role: user.role,
                profile_picture: user.profile_picture,
                store_id: storeData ? storeData.id : null,
                is_active: storeData ? storeData.is_active : (user.role === 'customer' ? 1 : 0)
            }
        });

    } catch (error) {
        console.error("❌ [Login Fatal Error]:", error.message);
        res.status(500).json({ success: false, message: "Terjadi kesalahan internal" });
    }
};



exports.logout = async (req, res) => {
    const userId = req.user ? req.user.id : req.body.userId;

    try {
        await db.query('UPDATE users SET fcm_token = NULL WHERE id = ?', [userId]);
        console.log(`🚪 [Logout Success] UID: ${userId}`);

        res.json({
            success: true,
            message: "Logout berhasil"
        });
    } catch (error) {
        console.error("❌ Logout Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.updateProfile = async (req, res) => {
    console.log("\n========== DEBUG UPDATE PROFILE ==========");
    console.log("[PAYLOAD BODY]:", req.body);
    console.log("[PAYLOAD FILE]:", req.file ? req.file.filename : "TIDAK ADA FILE");

    const { user_id, full_name, email, phone_number } = req.body;

    try {
        if (!user_id) {
            return res.status(400).json({ success: false, message: "User ID wajib ada" });
        }

        // 1. Ambil data lama dari database terlebih dahulu
        const [currentUser] = await db.query('SELECT profile_picture FROM users WHERE id = ?', [user_id]);
        if (currentUser.length === 0) {
            return res.status(404).json({ success: false, message: "User tidak ditemukan" });
        }

        let final_profile_picture = currentUser[0].profile_picture;

        // 2. Jika ada file baru, gunakan yang baru
        if (req.file) {
            final_profile_picture = `/uploads/profiles/${req.file.filename}`;
            console.log(`[SUCCESS] Menggunakan foto baru: ${final_profile_picture}`);
        } 
        // 3. Jika tidak ada file baru, tapi frontend mengirim path (mungkin path lama), 
        // kita tetap gunakan data dari DB (langkah 1) agar aman.

        // 4. Cek duplikasi email/phone
        const [existing] = await db.query(
            'SELECT id FROM users WHERE (email = ? OR phone_number = ?) AND id != ?',
            [email, phone_number, user_id]
        );

        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: "Email/No HP sudah dipakai orang lain" });
        }

        // 5. Update Database
        await db.query(
            'UPDATE users SET full_name = ?, email = ?, phone_number = ?, profile_picture = ? WHERE id = ?',
            [full_name, email, phone_number, final_profile_picture, user_id]
        );

        res.json({
            success: true,
            message: "Profil diperbarui",
            user: { 
                id: user_id, 
                full_name, 
                email, 
                phone_number, 
                profile_picture: final_profile_picture 
            }
        });

    } catch (error) {
        console.error("❌ Error:", error.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

exports.changePassword = async (req, res) => {
    const { user_id, old_password, new_password } = req.body;

    try {
        const [rows] = await db.query('SELECT password FROM users WHERE id = ?', [user_id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: "User tidak ditemukan" });

        const user = rows[0];

        const isMatch = await bcrypt.compare(old_password, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Password lama salah" });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(new_password, salt);

        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user_id]);

        res.json({ success: true, message: "Password berhasil diperbarui" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getProfile = async (req, res) => {
    const userId = req.user.id;

    try {
        console.log(`\n🔍 [DEBUG] Fetching Profile for UID: ${userId}`);

        const [rows] = await db.query(
            `SELECT u.id, u.full_name, u.email, u.phone_number, u.role, u.fcm_token, u.profile_picture,
             s.id AS store_id, s.is_active 
             FROM users u 
             LEFT JOIN stores s ON u.id = s.user_id 
             WHERE u.id = ?`,
            [userId]
        );

        if (rows.length === 0) {
            console.error(`❌ [DEBUG] User not found for UID: ${userId}`);
            return res.status(404).json({ success: false, message: "User tidak ditemukan" });
        }

        const user = rows[0];
        console.log(`✅ [DEBUG] Profile data retrieved for: ${user.email}`);

        res.json({
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
                is_active: user.role === 'customer' ? 1 : (user.is_active || 0)
            }
        });

    } catch (error) {
        console.error("❌ [DEBUG] Get Profile Error:", error.message);
        res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
    }
};

exports.requestReset = async (req, res) => {
    const { email } = req.body;
    try {
        const [user] = await db.query('SELECT id, full_name FROM users WHERE email = ?', [email]);
        
        if (user.length === 0) {
            // Demi keamanan, tetap beri respons sukses agar hacker tidak tahu email mana yang terdaftar
            return res.json({ success: true, message: "Jika email terdaftar, instruksi reset akan dikirim." });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expiry = new Date(Date.now() + 3600000); // 1 Jam

        await db.query(
            'UPDATE users SET reset_token = ?, reset_expiry = ? WHERE email = ?',
            [token, expiry, email]
        );

        // Panggil fungsi mailer baru
        await sendResetPasswordEmail(email, user[0].full_name, token);

        res.json({ success: true, message: "Instruksi reset password telah dikirim ke email." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Terjadi kesalahan sistem." });
    }
};

// 2. Eksekusi Reset Password (Update ke Database)
exports.resetPassword = async (req, res) => {
    const { token, newPassword } = req.body;

    try {
        // Cari user yang memiliki token tersebut DAN belum expired (reset_expiry > waktu sekarang)
        const [user] = await db.query(
            'SELECT id FROM users WHERE reset_token = ? AND reset_expiry > NOW()',
            [token]
        );

        if (user.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Token tidak valid atau sudah kedaluwarsa. Silakan minta link baru." 
            });
        }

        // Hash password baru (asumsi Anda menggunakan bcrypt)
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password baru & HAPUS token agar tidak bisa dipakai lagi (keamanan)
        await db.query(
            'UPDATE users SET password = ?, reset_token = NULL, reset_expiry = NULL WHERE id = ?',
            [hashedPassword, user[0].id]
        );

        res.json({ 
            success: true, 
            message: "Password Anda berhasil diperbarui. Silakan login." 
        });
    } catch (error) {
        console.error("❌ Reset Password Error:", error);
        res.status(500).json({ 
            success: false, 
            message: "Terjadi kesalahan server saat memperbarui password." 
        });
    }
};