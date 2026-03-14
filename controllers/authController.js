const admin = require('../config/firebaseConfig');
const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
import { sendPushNotification } from '../services/notificationService';

const JWT_SECRET = process.env.JWT_SECRET || 'bad750e525b96e0efaf8bf2e4daa19515a2dcf76e047f0aa28bb35eebd767a08';

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
            console.error("⚠️ FCM Admin (Register) Error:", fcmErr.message);
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

    try {
        // 1. Cari user
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.status(404).json({ success: false, message: "Email tidak terdaftar" });

        const user = users[0];

        // 2. VALIDASI ROLE (Pagar utama aplikasi)
        if (targetRole && user.role !== targetRole) {
            console.log(`🚫 [Login Blocked] UID ${user.id} mencoba login ke role ${targetRole}`);
            return res.status(403).json({
                success: false,
                message: `Akses Ditolak. Akun Anda terdaftar sebagai ${user.role}.`
            });
        }

        // 3. Verifikasi Password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ success: false, message: "Password salah" });

        // 4. Update FCM Token
        if (req.body.hasOwnProperty('fcm_token')) {
            await db.query('UPDATE users SET fcm_token = ? WHERE id = ?', [fcm_token || null, user.id]);
        }

        // 5. Ambil data Toko jika mitra
        let storeData = null;
        if (user.role === 'mitra') {
            const [stores] = await db.query('SELECT * FROM stores WHERE user_id = ?', [user.id]);
            storeData = stores[0] || null;
        }

        const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

        // LOGGING sebelum response dikirim
        console.log(`🔑 [Login Success] UID: ${user.id} | Email: ${user.email} | Phone: ${user.phone_number}`);

        // 6. Response Lengkap (WAJIB sertakan email & phone_number untuk Profil)
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,         // Ditambahkan kembali
                phone_number: user.phone_number, // Ditambahkan kembali
                role: user.role,
                store_id: storeData ? storeData.id : null,
                is_active: storeData ? storeData.is_active : (user.role === 'customer' ? 1 : 0)
            }
        });
    } catch (error) {
        console.error("❌ Login Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.googleAuth = async (req, res) => {
    const { idToken, role, fcm_token, targetRole } = req.body; // targetRole adalah role aplikasi (admin/mitra/customer)

    try {
        // 1. Verifikasi Token dari Firebase
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const { email, name } = decodedToken;

        // 2. Cek apakah user sudah ada
        const [rows] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
        let user = rows[0];

        if (!user) {
            // --- SKENARIO REGISTER VIA GOOGLE ---
            console.log(`🆕 [Google Register] Creating new user: ${email}`);

            const [result] = await db.query(
                "INSERT INTO users (full_name, email, phone_number, password, role, fcm_token) VALUES (?, ?, ?, ?, ?, ?)",
                [name, email, null, 'GOOGLE_AUTH', role || 'admin', fcm_token || null]
            );

            const userId = result.insertId;

            // 3. Inisialisasi tambahan jika mitra (Sama dengan register biasa)
            if (role === 'mitra') {
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

            // 4. VALIDASI ROLE (Pagar utama)
            // Jika user terdaftar sebagai 'customer' tapi coba login di aplikasi 'admin'
            if (targetRole && user.role !== targetRole) {
                return res.status(403).json({
                    success: false,
                    message: `Akses Ditolak. Akun Google ini terdaftar sebagai ${user.role}.`
                });
            }

            // 5. Update FCM Token jika ada yang baru
            if (fcm_token) {
                await db.query("UPDATE users SET fcm_token = ? WHERE id = ?", [fcm_token, user.id]);
            }
        }

        // 6. Ambil data Toko (untuk profil frontend)
        let storeId = null;
        if (user.role === 'mitra') {
            const [stores] = await db.query('SELECT id FROM stores WHERE user_id = ?', [user.id]);
            storeId = stores[0]?.id || null;
        }

        const token = generateToken(user);

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
        console.error("❌ Google Auth Error:", error.message);
        res.status(401).json({ success: false, message: "Token Google tidak valid atau kadaluwarsa" });
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

        // 1. Cek apakah email atau phone baru sudah dipakai user lain
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

        // 2. Update data di tabel users
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
            user: {
                full_name,
                email,
                phone_number
            }
        });

    } catch (error) {
        console.error("❌ Update Profile Error:", error.message);
        res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
    }
};