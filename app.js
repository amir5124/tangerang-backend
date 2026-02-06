require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
require('./jobs/cronJobs');

// --- 1. INISIALISASI FIREBASE ADMIN ---
// Cukup panggil file config yang sudah berhasil membaca dari Storage Coolify
const admin = require('./config/firebaseConfig');

// Import Routes
const authRoutes = require('./routes/authRoutes');
const mitraRoutes = require('./routes/mitraRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');

const app = express();

// --- 2. MIDDLEWARE CORS & JSON ---
const allowedOrigins = [
    'https://tangerangfast.netlify.app',
    'http://localhost:19006',
    'http://localhost:8081',
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log("🚫 CORS Terblokir untuk:", origin);
            callback(new Error('Akses ditolak oleh kebijakan CORS'));
        }
    },
    methods: 'GET,POST,PUT,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization',
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- 3. FILES & STATIC FOLDERS ---
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads/services', express.static(path.join(__dirname, 'uploads/services')));

// --- 4. ROUTE PENGETESAN ---
app.get('/api', (req, res) => {
    res.json({
        message: "API Tangerang Mandiri Aktif",
        status: "Connected",
        firebase: admin.apps.length > 0 ? "Ready" : "Not Initialized"
    });
});

// --- 5. REGISTER ROUTES ---
app.use('/api/auth', authRoutes);
app.use('/api/mitra', mitraRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payment', paymentRoutes);

// --- 6. SERVER LISTENING ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`-------------------------------------------`);
    console.log(`🚀 Server aktif di: http://localhost:${PORT}`);
    // Status ini akan mengambil kondisi dari inisialisasi di firebaseConfig.js
    console.log(`📡 Firebase Status: ${admin.apps.length > 0 ? '🟢 Online' : '🔴 Offline'}`);
    console.log(`-------------------------------------------`);
});