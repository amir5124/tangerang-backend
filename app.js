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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});