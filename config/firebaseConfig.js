const admin = require('firebase-admin');

try {
    const rawData = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (rawData) {
        let serviceAccount;
        const trimmedData = rawData.trim();

        // LOGIKA DETEKSI:
        // Jika diawali '{', maka itu JSON biasa. 
        // Jika tidak, maka itu Base64 (seperti yang ada di log Anda sekarang).
        if (trimmedData.startsWith('{')) {
            serviceAccount = JSON.parse(trimmedData);
            console.log("✅ Firebase: Menggunakan format JSON langsung.");
        } else {
            console.log("📦 Firebase: Mendeteksi format Base64, melakukan decoding...");
            const decodedData = Buffer.from(trimmedData, 'base64').toString('utf-8');
            serviceAccount = JSON.parse(decodedData);
        }

        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log("✅ Firebase Admin SDK Berhasil Aktif!");
        }
    } else {
        console.warn("⚠️ Warning: FIREBASE_SERVICE_ACCOUNT tidak ditemukan di Environment Variables.");
    }
} catch (error) {
    console.error("❌ Gagal inisialisasi Firebase Admin:");
    console.error("Detail Error:", error.message);
    // Jika masih gagal parse JSON setelah decode, tampilkan sedikit potongan data untuk debug
    if (error.message.includes('JSON')) {
        console.error("Tips: Pastikan string Base64 di Coolify tidak mengandung kutip atau karakter tambahan.");
    }
}

module.exports = admin;