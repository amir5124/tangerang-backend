// config/firebaseConfig.js
const admin = require('firebase-admin');
const path = require('path');

// Menggunakan path.join dan __dirname agar lokasi file dicari secara absolut
// __dirname adalah folder 'config', jadi kita naik satu level ke root
const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');

try {
    // Gunakan require untuk memuat file JSON
    const serviceAccount = require(serviceAccountPath);

    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("✅ Firebase Admin SDK Initialized Successfully from Root");
    }
} catch (error) {
    console.error("❌ Firebase Admin Initialization Error:");
    console.error("Lokasi yang dicari:", serviceAccountPath);
    console.error("Pesan Error:", error.message);

    if (error.code === 'MODULE_NOT_FOUND') {
        console.error("Tips: File serviceAccountKey.json tidak ditemukan di root folder server.");
    }
}

module.exports = admin;