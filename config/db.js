const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Tambahkan log ini untuk cek koneksi saat startup
pool.getConnection((err, connection) => {
    if (err) {
        console.error("❌ [DB] Gagal Koneksi ke MySQL:", err.message);
        console.log("👉 Pastikan IP MacBook sudah di-whitelist di server database atau gunakan localhost jika DB ada di laptop.");
    } else {
        console.log("✅ [DB] Terhubung ke Database Tangerang Mandiri.");
        connection.release();
    }
});

module.exports = pool.promise();