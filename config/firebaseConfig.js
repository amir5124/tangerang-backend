const admin = require('firebase-admin');

try {
    const rawData = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (rawData) {
        let serviceAccount;
        const trimmedData = rawData.trim();

        // Cek apakah data adalah JSON biasa (diawali {) atau Base64
        if (trimmedData.startsWith('{')) {
            // Jika JSON biasa
            serviceAccount = JSON.parse(trimmedData);
        } else {
            // Jika Base64 (seperti yang Anda masukkan di Coolify sekarang)
            console.log("📦 Mendeteksi format Base64, mencoba melakukan decoding...");
            const decodedData = Buffer.from(trimmedData, 'base64').toString('utf-8');
            serviceAccount = JSON.parse(decodedData);
        }

        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log("✅ Firebase Admin SDK Initialized Successfully!");
        }
    } else {
        console.warn("⚠️ Warning: FIREBASE_SERVICE_ACCOUNT tidak ditemukan di Environment Variables.");
    }
} catch (error) {
    console.error("❌ Firebase Admin Initialization Error:");
    console.error("Detail:", error.message);
}

module.exports = admin;