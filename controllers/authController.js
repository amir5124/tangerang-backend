const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Fallback JWT Secret jika di .env atau Coolify kosong
const JWT_SECRET = process.env.JWT_SECRET || 'bad750e525b96e0efaf8bf2e4daa19515a2dcf76e047f0aa28bb35eebd767a08';

exports.register = async (req, res) => {
    const { full_name, email, phone_number, password, role, fcm_token } = req.body;

    try {
        // 1. Cek duplikasi Email atau Nomor HP
        const [existingUser] = await db.query(
            'SELECT id FROM users WHERE email = ? OR phone_number = ?',
            [email, phone_number]
        );

        if (existingUser.length > 0) {
            return res.status(400).json({ message: "Email atau Nomor HP sudah digunakan" });
        }

        // 2. Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 3. Simpan User Baru
        // Saldo tidak perlu di-insert karena default 0.00 di database
        const [userResult] = await db.query(
            'INSERT INTO users (full_name, email, phone_number, password, role, fcm_token) VALUES (?, ?, ?, ?, ?, ?)',
            [full_name, email, phone_number, hashedPassword, role, fcm_token || null]
        );

        const userId = userResult.insertId;

        // 4. Inisialisasi Toko jika role adalah Mitra
        if (role === 'mitra') {
            await db.query(
                'INSERT INTO stores (user_id, store_name, address, latitude, longitude) VALUES (?, ?, ?, 0, 0)',
                [userId, `Toko ${full_name}`, 'Alamat belum diatur']
            );
        }

        res.status(201).json({ message: "Registrasi berhasil", userId });
    } catch (error) {
        console.error("❌ Register Error:", error.message);
        res.status(500).json({ message: "Gagal menyimpan data", error: error.message });
    }
};

exports.login = async (req, res) => {
    const { email, password, fcm_token } = req.body;

    try {
        // 1. Cari user berdasarkan email
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.status(404).json({ message: "User tidak ditemukan" });

        const user = users[0];

        // 2. Verifikasi Password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: "Password salah" });

        // 3. Update FCM Token (untuk push notification di HP yang digunakan saat ini)
        if (fcm_token) {
            await db.query('UPDATE users SET fcm_token = ? WHERE id = ?', [fcm_token, user.id]);
        }

        // 4. Generate JWT Token (menggunakan fallback secret)
        const token = jwt.sign(
            { id: user.id, role: user.role },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        // 5. Kirim response termasuk Saldo
        res.json({
            token,
            user: {
                id: user.id,
                full_name: user.full_name,
                role: user.role,
                phone_number: user.phone_number,
                saldo: user.saldo // Diambil dari database decimal(15,2)
            }
        });
    } catch (error) {
        console.error("❌ Login Error:", error.message);
        res.status(500).json({ error: error.message });
    }
};