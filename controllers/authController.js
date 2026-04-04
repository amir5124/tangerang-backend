const admin = require('../config/firebaseConfig');
const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { sendPushNotification } = require('../services/notificationService');
const { OAuth2Client } = require('google-auth-library');

const JWT_SECRET = process.env.JWT_SECRET || 'bad750e525b96e0efaf8bf2e4daa19515a2dcf76e047f0aa28bb35eebd767a08';

// CLIENT ID HARDCODED
const GOOGLE_CLIENT_ID_ADMIN = "206607018424-u9a7v54du628kt7mmnlcclsvq3og33ce.apps.googleusercontent.com";
const GOOGLE_CLIENT_ID_CUSTOMER = "206607018424-vpr9bdfrk6oedfcvouf5i5e3lan7ckoh.apps.googleusercontent.com";

const client = new OAuth2Client(GOOGLE_CLIENT_ID_ADMIN);

const generateToken = (user) => {
    return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
};

exports.register = async (req, res) => {
    const { full_name, email, phone_number, password, role, fcm_token } = req.body;

    try {
        // 1. Cek duplikasi
        const [existingUser] = await db.query(
            'SELECT id FROM users WHERE email = ? OR phone_number = ?',
            [email, phone_number]
        );

        if (existingUser.length > 0) {
            return res.status(400).json({ success: false, message: "Email atau Nomor HP sudah digunakan" });
        }

        // 2. Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 3. Simpan User
        const [userResult] = await db.query(
            'INSERT INTO users (full_name, email, phone_number, password, role, fcm_token) VALUES (?, ?, ?, ?, ?, ?)',
            [full_name, email, phone_number, hashedPassword, role, fcm_token || null]
        );

        const userId = userResult.insertId;
        let storeId = null;

        // 4. Inisialisasi tambahan jika role adalah mitra
        if (role === 'mitra') {
            const [storeResult] = await db.query(
                `INSERT INTO stores (user_id, store_name, category, address, latitude, longitude, approval_status, is_active) 
                 VALUES (?, ?, ?, ?, 0, 0, 'pending', 0)`,
                [userId, `${full_name} Service`, 'ac', 'Alamat belum diatur']
            );
            storeId = storeResult.insertId;
            await db.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0)', [userId]);
        }

        // 5. Generate Token
        const token = jwt.sign({ id: userId, role: role }, JWT_SECRET, { expiresIn: '30d' });

        // --- TAMBAHAN: NOTIFIKASI KE ADMIN ---
        try {
            const [admins] = await db.query(
                "SELECT fcm_token FROM users WHERE role = 'admin' AND fcm_token IS NOT NULL"
            );

            if (admins.length > 0) {
                const title = "Pengguna Baru Berhasil Daftar 👤";
                const body = `User baru ${full_name} (${role}) telah bergabung.`;

                for (const admin of admins) {
                    await sendPushNotification(admin.fcm_token, title, body, {
                        type: "NEW_USER_REGISTERED",
                        userId: String(userId),
                        role: role
                    });
                }
            }
        } catch (fcmErr) {
            // Tambahkan detail log untuk melihat alasan teknis dari Firebase
            console.error("⚠️ FCM Admin (Register) Error Detail:", fcmErr);
        }
        // --- END TAMBAHAN ---

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
                store_id: storeId
            }
        });

    } catch (error) {
        console.error("❌ Register Error:", error.message);
        res.status(500).json({ success: false, message: "Gagal register", error: error.message });
    }
};

exports.login = async (req, res) => {
    const { email, password, fcm_token, targetRole } = req.body;
    const genericError = "Email atau Password salah";

    try {
        // 1. Cari user
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

        // Jangan beri tahu hacker kalau emailnya benar tapi password salah
        if (users.length === 0) {
            return res.status(401).json({ success: false, message: genericError });
        }

        const user = users[0];

        // 2. Verifikasi Password (Proses berat)
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: genericError });
        }

        // 3. VALIDASI ROLE
        if (targetRole && user.role !== targetRole) {
            console.warn(`🚫 [Role Mismatch] UID ${user.id} mencoba masuk sebagai ${targetRole}`);
            return res.status(403).json({
                success: false,
                message: `Akses Ditolak. Akun Anda terdaftar sebagai ${user.role}.`
            });
        }

        // 4. Update FCM Token (Hanya jika berubah)
        const isValidFCM = fcm_token && fcm_token !== 'null' && fcm_token.trim() !== '';
        if (isValidFCM && fcm_token !== user.fcm_token) {
            await db.query('UPDATE users SET fcm_token = ? WHERE id = ?', [fcm_token, user.id]);
            console.log(`📱 [FCM Updated] UID: ${user.id}`);
        }

        // 5. Ambil data Toko (Jika Mitra)
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
                store_id: storeData ? storeData.id : null,
                is_active: storeData ? storeData.is_active : (user.role === 'customer' ? 1 : 0)
            }
        });

    } catch (error) {
        console.error("❌ [Login Fatal Error]:", error.message);
        res.status(500).json({ success: false, message: "Terjadi kesalahan internal" });
    }
};


exports.googleAuth = async (req, res) => {
    const { idToken, role, fcm_token, targetRole } = req.body;

    // DEBUG: Cek input dari frontend
    console.log("🔍 [DEBUG GOOGLE] Incoming Request:", {
        targetRole,
        providedRole: role,
        hasFcmToken: !!fcm_token
    });

    try {
        // 1. Verifikasi ID Token
        const ticket = await client.verifyIdToken({
            idToken: idToken,
            audience: [
                GOOGLE_CLIENT_ID_ADMIN,
                GOOGLE_CLIENT_ID_CUSTOMER
            ],
        });

        const payload = ticket.getPayload();
        const { email, name } = payload;

        console.log(`🔍 [DEBUG GOOGLE] Token Verified. Email: ${email}, Name: ${name}`);

        // 2. Cek apakah user sudah ada
        const [rows] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
        let user = rows[0];

        if (!user) {
            // --- SKENARIO REGISTER VIA GOOGLE ---
            console.log(`🆕 [DEBUG GOOGLE] User ${email} tidak ditemukan. Memulai proses REGISTER.`);

            const [result] = await db.query(
                "INSERT INTO users (full_name, email, phone_number, password, role, fcm_token) VALUES (?, ?, ?, ?, ?, ?)",
                [name, email, null, 'GOOGLE_AUTH', role || 'customer', fcm_token || null]
            );

            const userId = result.insertId;
            console.log(`✅ [DEBUG GOOGLE] User baru berhasil dibuat. UID: ${userId}`);

            // 3. Inisialisasi tambahan jika mitra
            if (role === 'mitra') {
                console.log(`🏪 [DEBUG GOOGLE] Inisialisasi toko untuk mitra UID: ${userId}`);
                await db.query(
                    `INSERT INTO stores (user_id, store_name, category, address, latitude, longitude, approval_status, is_active) 
                     VALUES (?, ?, ?, ?, 0, 0, 'pending', 0)`,
                    [userId, `${name} Service`, 'ac', 'Alamat belum diatur']
                );
                await db.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0)', [userId]);
            }

            const [newUser] = await db.query("SELECT * FROM users WHERE id = ?", [userId]);
            user = newUser[0];
        } else {
            // --- SKENARIO LOGIN VIA GOOGLE ---
            console.log(`🔑 [DEBUG GOOGLE] User ${email} ditemukan. Memulai proses LOGIN.`);

            // 4. VALIDASI ROLE
            console.log(`⚖️ [DEBUG GOOGLE] Checking Role: DB_Role(${user.role}) vs Target_Role(${targetRole})`);
            if (targetRole && user.role !== targetRole) {
                console.warn(`🚫 [DEBUG GOOGLE] Role Mismatch for ${email}. Access Blocked.`);
                return res.status(403).json({
                    success: false,
                    message: `Akses Ditolak. Akun Google ini terdaftar sebagai ${user.role}.`
                });
            }

            // 5. Update FCM Token
            if (fcm_token) {
                console.log(`📱 [DEBUG GOOGLE] Updating FCM Token for UID: ${user.id}`);
                await db.query("UPDATE users SET fcm_token = ? WHERE id = ?", [fcm_token, user.id]);
            }
        }

        // 6. Ambil data Toko (untuk profil frontend)
        let storeId = null;
        if (user.role === 'mitra') {
            const [stores] = await db.query('SELECT id FROM stores WHERE user_id = ?', [user.id]);
            storeId = stores[0]?.id || null;
            console.log(`🏪 [DEBUG GOOGLE] Store ID ditemukan: ${storeId}`);
        }

        const token = generateToken(user);

        // DEBUG Final Response
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
    const { user_id, full_name, email, phone_number } = req.body;

    try {
        console.log(`\n[DEBUG] Updating User Profile for UID: ${user_id}`);

        const [existing] = await db.query(
            'SELECT id FROM users WHERE (email = ? OR phone_number = ?) AND id != ?',
            [email, phone_number, user_id]
        );

        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Email atau Nomor HP sudah digunakan oleh akun lain"
            });
        }

        const [result] = await db.query(
            'UPDATE users SET full_name = ?, email = ?, phone_number = ? WHERE id = ?',
            [full_name, email, phone_number, user_id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "User tidak ditemukan" });
        }

        res.json({
            success: true,
            message: "Profil personal berhasil diperbarui",
            user: { full_name, email, phone_number }
        });

    } catch (error) {
        console.error("❌ Update Profile Error:", error.message);
        res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
    }
};

exports.changePassword = async (req, res) => {
    const { user_id, old_password, new_password } = req.body;

    try {
        // 1. Cari user di database
        const [rows] = await db.query('SELECT password FROM users WHERE id = ?', [user_id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: "User tidak ditemukan" });

        const user = rows[0];

        // 2. Validasi password lama
        const isMatch = await bcrypt.compare(old_password, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Password lama salah" });
        }

        // 3. Hash password baru
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(new_password, salt);

        // 4. Update ke database
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
            `SELECT u.id, u.full_name, u.email, u.phone_number, u.role, u.fcm_token, 
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
                store_id: user.store_id,
                is_active: user.role === 'customer' ? 1 : (user.is_active || 0)
            }
        });

    } catch (error) {
        console.error("❌ [DEBUG] Get Profile Error:", error.message);
        res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
    }
};