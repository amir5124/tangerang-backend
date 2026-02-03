const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'bad750e525b96e0efaf8bf2e4daa19515a2dcf76e047f0aa28bb35eebd767a08';

exports.register = async (req, res) => {
    const { full_name, email, phone_number, password, role, fcm_token } = req.body;

    try {
        const [existingUser] = await db.query(
            'SELECT id FROM users WHERE email = ? OR phone_number = ?',
            [email, phone_number]
        );

        if (existingUser.length > 0) {
            return res.status(400).json({ message: "Email atau Nomor HP sudah digunakan" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [userResult] = await db.query(
            'INSERT INTO users (full_name, email, phone_number, password, role, fcm_token) VALUES (?, ?, ?, ?, ?, ?)',
            [full_name, email, phone_number, hashedPassword, role, fcm_token || null]
        );

        const userId = userResult.insertId;
        let storeId = null;

        // --- MODIFIKASI UNTUK MITRA ---
        if (role === 'mitra') {
            const [storeResult] = await db.query(
                `INSERT INTO stores (user_id, store_name, category, address, latitude, longitude, approval_status, is_active) 
                 VALUES (?, ?, ?, ?, 0, 0, 'pending', 0)`,
                [userId, `${full_name} Service`, 'ac', 'Alamat belum diatur']
            );
            storeId = storeResult.insertId; // Ambil ID toko yang baru dibuat
        }

        // --- BUAT TOKEN JWT AGAR FRONTEND BISA LANGSUNG LOGIN ---
        const token = jwt.sign(
            { id: userId, role: role },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        // --- KIRIM RESPONSE LENGKAP (Sesuai kebutuhan Frontend) ---
        res.status(201).json({
            message: "Registrasi berhasil",
            token, // Token JWT (Kunci akses)
            user: {
                id: userId,
                full_name,
                role,
                phone_number,
                store_id: storeId, // Store ID untuk Dashboard Mitra
                is_active: 0 // Default belum aktif
            }
        });

    } catch (error) {
        console.error("❌ Register Error:", error.message);
        res.status(500).json({ message: "Gagal menyimpan data", error: error.message });
    }
};

exports.login = async (req, res) => {
    const { email, password, fcm_token } = req.body;

    try {
        // 1. Cari user
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.status(404).json({ message: "User tidak ditemukan" });

        const user = users[0];

        // 2. Verifikasi Password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: "Password salah" });

        // 3. Ambil data Toko (Jika role-nya mitra)
        let storeData = null;
        if (user.role === 'mitra') {
            const [stores] = await db.query('SELECT * FROM stores WHERE user_id = ?', [user.id]);
            if (stores.length > 0) {
                storeData = stores[0];
            }
        }

        // 4. Update FCM Token
        if (fcm_token) {
            await db.query('UPDATE users SET fcm_token = ? WHERE id = ?', [fcm_token, user.id]);
        }

        const token = jwt.sign(
            { id: user.id, role: user.role },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        // 5. Response Lengkap dengan Status Verifikasi (is_active)
        res.json({
            token,
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                role: user.role,
                phone_number: user.phone_number,
                saldo: user.saldo,
                // Tambahkan info toko agar frontend bisa cek status verifikasi
                store_id: storeData ? storeData.id : null,
                is_active: storeData ? storeData.is_active : (user.role === 'admin' ? 1 : 0)
            }
        });
    } catch (error) {
        console.error("❌ Login Error:", error.message);
        res.status(500).json({ error: error.message });
    }
};