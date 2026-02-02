require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// Import Routes
const authRoutes = require('./routes/authRoutes');
const mitraRoutes = require('./routes/mitraRoutes');
const serviceRoutes = require('./routes/serviceRoutes');

const app = express();

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Static Folder ---
// Penting agar gambar dari backend bisa tampil di React Native
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Route Pengetesan ---
app.get('/api', (req, res) => {
    res.json({
        message: "API Tangerang Mandiri Aktif",
        status: "Connected"
    });
});

// --- Register Routes ---
app.use('/api/auth', authRoutes);      // Registrasi & Login
app.use('/api/mitra', mitraRoutes);    // Manajemen Store/Mitra (Sesuai kode kamu)
app.use('/api/services', serviceRoutes); // Manajemen Jasa/Produk

// --- Server Listening ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`-------------------------------------------`);
    console.log(`🚀 Server aktif di: http://localhost:${PORT}`);
    console.log(`🌐 Akses Network: http://192.168.176.251:${PORT}`);
    console.log(`-------------------------------------------`);
});