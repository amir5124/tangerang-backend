const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'bad750e525b96e0efaf8bf2e4daa19515a2dcf76e047f0aa28bb35eebd767a08';

/**
 * 1. Middleware Utama: Verifikasi Token
 * Digunakan di hampir semua rute yang membutuhkan login.
 */
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer TOKEN"

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Akses ditolak, silakan login terlebih dahulu"
        });
    }

    try {
        const verified = jwt.verify(token, JWT_SECRET);

        // Simpan data user (id & role) ke objek req agar bisa dipakai di controller/middleware berikutnya
        req.user = verified;
        next();
    } catch (error) {
        // Bedakan pesan error jika token sudah expired
        const message = error.name === 'TokenExpiredError'
            ? "Sesi telah berakhir, silakan login kembali"
            : "Token tidak valid";

        res.status(403).json({ success: false, message });
    }
};

/**
 * 2. Middleware Khusus MITRA
 */
const isMitra = (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Sesi tidak ditemukan" });

    if (req.user.role === 'mitra') {
        next();
    } else {
        res.status(403).json({
            success: false,
            message: "Akses ditolak: Area ini hanya untuk akun Mitra"
        });
    }
};

/**
 * 3. Middleware Khusus CUSTOMER
 */
const isCustomer = (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Sesi tidak ditemukan" });

    if (req.user.role === 'customer') {
        next();
    } else {
        res.status(403).json({
            success: false,
            message: "Akses ditolak: Area ini hanya untuk akun Customer"
        });
    }
};

/**
 * 4. Middleware Khusus ADMIN
 */
const isAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Sesi tidak ditemukan" });

    if (req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({
            success: false,
            message: "Akses terlarang: Memerlukan hak akses Admin"
        });
    }
};

module.exports = {
    authenticateToken,
    isMitra,
    isCustomer,
    isAdmin
};