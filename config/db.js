const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || '31.97.220.59',
    user: process.env.DB_USER || 'mysql',
    password: process.env.DB_PASS || 'HBUduUGKu7FfNtySo8BVr151PmyP5J5opS0J8UW9egKGkuTe4nQeoTLJadD1QXFm',
    database: process.env.DB_NAME || 'tangerang_mandiri',
    port: 32771,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Cek koneksi saat server nyala
pool.getConnection((err, connection) => {
    if (err) {
        console.error("❌ [DB] Koneksi Gagal:", err.message);
    } else {
        console.log("✅ [DB] Terhubung menggunakan:", process.env.DB_HOST ? "Environment Variable" : "Hardcoded IP");
        connection.release();
    }
});

module.exports = pool.promise();