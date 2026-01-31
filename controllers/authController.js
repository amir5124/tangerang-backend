const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.register = async (req, res) => {
    // 1. TANGKAP fcm_token dari body (Sebelumnya ini terlewat)
    const { full_name, email, phone_number, password, role, fcm_token } = req.body;

    try {
        // 2. Cek apakah email atau nomor HP sudah terdaftar
        const [existingUser] = await db.query(
            'SELECT id FROM users WHERE email = ? OR phone_number = ?',
            [email, phone_number]
        );

        if (existingUser.length > 0) {
            return res.status(400).json({ message: "Email atau Nomor HP sudah digunakan" });
        }

        // 3. Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 4. Simpan User Baru (Sertakan fcm_token)
        // Kolom 'saldo' tidak perlu ditulis di sini karena sudah ada DEFAULT 0 di database
        const [userResult] = await db.query(
            'INSERT INTO users (full_name, email, phone_number, password, role, fcm_token) VALUES (?, ?, ?, ?, ?, ?)',
            [full_name, email, phone_number, hashedPassword, role, fcm_token || null]
        );

        const userId = userResult.insertId;

        // 5. JIKA ROLE MITRA: Inisialisasi Toko Kosong
        if (role === 'mitra') {
            await db.query(
                'INSERT INTO stores (user_id, store_name, address, latitude, longitude) VALUES (?, ?, ?, 0, 0)',
                [userId, `Toko ${full_name}`, 'Alamat belum diatur']
            );
        }

        res.status(201).json({ message: "Registrasi berhasil", userId });
    } catch (error) {
        console.error("❌ Database Error:", error.message);
        res.status(500).json({ message: "Gagal menyimpan data", error: error.message });
    }
};

exports.login = async (req, res) => {
    const { email, password, fcm_token } = req.body;

    try {
        // Ambil semua kolom termasuk saldo
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.status(404).json({ message: "User tidak ditemukan" });

        const user = users[0];

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: "Password salah" });

        // Update FCM Token agar tetap sinkron tiap kali login
        if (fcm_token) {
            await db.query('UPDATE users SET fcm_token = ? WHERE id = ?', [fcm_token, user.id]);
        }

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
                role: user.role,
                phone_number: user.phone_number,
                saldo: user.saldo // SEKARANG SALDO IKUT DIKIRIM KE HP
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};