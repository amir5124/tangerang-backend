// config/firebaseConfig.js
const admin = require('firebase-admin');
const path = require('path');

/**
 * Menggunakan path.join dan process.cwd() untuk memastikan 
 * lokasi file serviceAccountKey.json selalu mengacu pada root folder.
 */
const serviceAccountPath = path.join(process.cwd(), 'serviceAccountKey.json');

try {
    // Memuat file JSON dari path absolut
    const serviceAccount = require(serviceAccountPath);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    console.log("✅ Firebase Admin SDK Initialized Successfully");
} catch (error) {
    console.error("❌ Firebase Admin Initialization Error:");
    console.error("Searched Path:", serviceAccountPath);
    console.error("Error Detail:", error.message);

    // Memberikan petunjuk jika file tidak ditemukan
    if (error.code === 'MODULE_NOT_FOUND') {
        console.error("Tips: Pastikan file serviceAccountKey.json ada di root folder aplikasi Anda.");
    }
}

module.exports = admin;