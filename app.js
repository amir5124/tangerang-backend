require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');

const app = express();

// Middleware
app.use(cors()); // Mengizinkan akses dari aplikasi mobile
app.use(express.json()); // Membaca body request format JSON

// Route Pengetesan (Sesuai rencana sebelumnya)
app.get('/api', (req, res) => {
    res.json({ 
        message: "Halo dari Node.js! Jalur kabel data sudah benar.",
        status: "Connected"
    });
});

// Routes API
app.use('/api/auth', authRoutes);

// Menjalankan Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});