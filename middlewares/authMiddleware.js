const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'bad750e525b96e0efaf8bf2e4daa19515a2dcf76e047f0aa28bb35eebd767a08';

// 1. Middleware untuk memverifikasi TOKEN JWT (Umum)
const authenticateToken = (req, res, next) => {
    const authHeader = req.header('Authorization');
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: "Akses ditolak, token tidak ditemukan" });
    }

    try {
        const verified = jwt.verify(token, JWT_SECRET);
        req.user = verified; // Menyimpan data {id, role} ke dalam request
        next();
    } catch (error) {
        res.status(403).json({ message: "Token tidak valid atau telah kadaluwarsa" });
    }
};

// 2. Middleware khusus MITRA
const isMitra = (req, res, next) => {
    if (req.user && req.user.role === 'mitra') {
        next();
    } else {
        res.status(403).json({ message: "Akses ditolak: Hanya untuk Mitra" });
    }
};

// 3. Middleware khusus CUSTOMER
const isCustomer = (req, res, next) => {
    if (req.user && req.user.role === 'customer') {
        next();
    } else {
        res.status(403).json({ message: "Akses ditolak: Hanya untuk Customer" });
    }
};

// 4. Middleware khusus ADMIN
const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: "Akses ditolak: Hanya untuk Admin" });
    }
};

module.exports = {
    authenticateToken,
    isMitra,
    isCustomer,
    isAdmin
};