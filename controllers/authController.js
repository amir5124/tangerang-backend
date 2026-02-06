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
            return res.status(400).json({ success: false, message: "Email atau Nomor HP sudah digunakan" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [userResult] = await db.query(
            'INSERT INTO users (full_name, email, phone_number, password, role, fcm_token) VALUES (?, ?, ?, ?, ?, ?)',
            [full_name, email, phone_number, hashedPassword, role, fcm_token || null]
        );

        const userId = userResult.insertId;
        let storeId = null;

        // Inisialisasi Store jika pendaftar adalah mitra
        if (role === 'mitra') {
            const [storeResult] = await db.query(
                `INSERT INTO stores (user_id, store_name, category, address, latitude, longitude, approval_status, is_active) 
                 VALUES (?, ?, ?, ?, 0, 0, 'pending', 0)`,
                [userId, `${full_name} Service`, 'ac', 'Alamat belum diatur']
            );
            storeId = storeResult.insertId;

            // Inisialisasi Wallet Mitra
            await db.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0)', [userId]);
        }

        const token = jwt.sign({ id: userId, role: role }, JWT_SECRET, { expiresIn: '30d' });

        res.status(201).json({
            success: true,
            message: "Registrasi berhasil",
            token,
            user: { id: userId, full_name, role, store_id: storeId }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal register", error: error.message });
    }
};

exports.login = async (req, res) => {
    // targetRole dikirim dari Frontend (Customer App kirim 'customer', Mitra App kirim 'mitra')
    const { email, password, fcm_token, targetRole } = req.body;

    try {
        // 1. Cari user berdasarkan email
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.status(404).json({ success: false, message: "Email tidak terdaftar" });

        const user = users[0];

        // 2. VALIDASI ROLE (Pagar Utama agar token tidak keliru)
        if (targetRole && user.role !== targetRole) {
            return res.status(403).json({
                success: false,
                message: `Akses Ditolak. Akun Anda terdaftar sebagai ${user.role}, bukan ${targetRole}.`
            });
        }

        // 3. Verifikasi Password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ success: false, message: "Password salah" });

        // 4. Update FCM Token (Selalu update saat login agar push notif tidak salah sasaran)
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

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                full_name: user.full_name,
                role: user.role,
                store_id: storeData ? storeData.id : null,
                is_active: storeData ? storeData.is_active : (user.role === 'customer' ? 1 : 0)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.logout = async (req, res) => {
    // Tips Keamanan: Ambil userId dari req.user.id (hasil middleware) 
    // daripada dari req.body untuk mencegah user menghapus token orang lain.
    const userId = req.user ? req.user.id : req.body.userId;

    try {
        // Hapus FCM token di database agar notifikasi tidak nyasar ke HP ini lagi
        await db.query('UPDATE users SET fcm_token = NULL WHERE id = ?', [userId]);

        res.json({
            success: true,
            message: "Logout berhasil, token FCM telah dihapus"
        });
    } catch (error) {
        console.error("❌ Logout Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};