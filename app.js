require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');

// --- 1. INISIALISASI FIREBASE ADMIN ---
// Pastikan file serviceAccountKey.json ada di folder 'config' atau root
try {
    const serviceAccount = require('./serviceAccountKey.json');

    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("✅ Firebase Admin Berhasil Diinisialisasi");
    }
} catch (error) {
    console.error("❌ Gagal inisialisasi Firebase Admin:", error.message);
    console.log("⚠️ Notifikasi push mungkin tidak akan berfungsi.");
}

// Import Routes
const authRoutes = require('./routes/authRoutes');
const mitraRoutes = require('./routes/mitraRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');

const app = express();

// --- 2. MIDDLEWARE CORS & JSON ---
const allowedOrigins = [
    'https://tangerangfast.netlify.app', // Web Production
    'http://localhost:19006',            // Expo Go (Lokal)
    'http://localhost:8081',             // Expo Web (Lokal)
];

app.use(cors({
    origin: function (origin, callback) {
        // Izinkan request tanpa origin (seperti Mobile App atau Postman)
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log("🚫 CORS Terblokir untuk:", origin);
            callback(new Error('Akses ditolak oleh kebijakan CORS'));
        }
    },
    methods: 'GET,POST,PUT,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization'
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
    console.log(`🌐 Akses Network: http://192.168.176.251:${PORT}`);
    console.log(`📡 Firebase Status: ${admin.apps.length > 0 ? '🟢 Online' : '🔴 Offline'}`);
    console.log(`-------------------------------------------`);
});