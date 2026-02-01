require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const mitraRoutes = require('./routes/mitraRoutes'); // 1. Import rute mitra baru

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Route Pengetesan
app.get('/api', (req, res) => {
    res.json({
        message: "Halo dari Node.js! Jalur kabel data sudah benar.",
        status: "Connected"
    });
});

// Routes API
app.use('/api/auth', authRoutes);
app.use('/api', mitraRoutes); // 2. Daftarkan rute mitra (tanpa /auth karena ini rute publik/manajemen)

// Menjalankan Server
// Ganti bagian app.listen kamu dengan ini:
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    // Tips: Cetak IP asli di console agar mudah copy-paste
    console.log(`Server aktif di: http://192.168.176.251:${PORT}`);
});