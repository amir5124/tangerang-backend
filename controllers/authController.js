const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.register = async (req, res) => {
    const { full_name, email, phone_number, password, role } = req.body;

    try {
        // 1. Cek apakah email sudah terdaftar
        const [existingUser] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            return res.status(400).json({ message: "Email sudah digunakan" });
        }

        // 2. Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 3. Simpan User Baru
        const [userResult] = await db.query(
            'INSERT INTO users (full_name, email, phone_number, password, role) VALUES (?, ?, ?, ?, ?)',
            [full_name, email, phone_number, hashedPassword, role]
        );

        const userId = userResult.insertId;

        // 4. JIKA ROLE MITRA: Buat Wallet & Inisialisasi Toko Kosong
        if (role === 'mitra') {
            await db.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0)', [userId]);
            await db.query(
                'INSERT INTO stores (user_id, store_name, address, latitude, longitude) VALUES (?, ?, ?, 0, 0)',
                [userId, `Toko ${full_name}`, 'Alamat belum diatur']
            );
        }

        res.status(201).json({ message: "Registrasi berhasil", userId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.login = async (req, res) => {
    const { email, password, fcm_token } = req.body;

    try {
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.status(404).json({ message: "User tidak ditemukan" });

        const user = users[0];

        // Cek Password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: "Password salah" });

        // Update FCM Token (Penting agar HP bisa bunyi saat ada orderan)
        if (fcm_token) {
            await db.query('UPDATE users SET fcm_token = ? WHERE id = ?', [fcm_token, user.id]);
        }

        // Buat JWT Token
        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                full_name: user.full_name,
                role: user.role
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};