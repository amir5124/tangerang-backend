const admin = require('firebase-admin');

try {
    // 1. Ambil string rahasia dari file .env
    const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (serviceAccountRaw) {
        // 2. Ubah string tersebut menjadi format Object/JSON agar bisa dibaca Firebase
        const serviceAccount = JSON.parse(serviceAccountRaw);

        // 3. Jalankan inisialisasi hanya jika belum ada app yang aktif
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log("✅ Firebase Admin SDK Initialized Successfully via ENV");
        }
    } else {
        // Jika variabel di .env tidak ditemukan
        throw new Error("Variabel FIREBASE_SERVICE_ACCOUNT tidak ditemukan di .env");
    }
} catch (error) {
    console.error("❌ Firebase Admin Initialization Error:");
    console.error("Detail:", error.message);
    console.log("⚠️ Tips: Pastikan isi FIREBASE_SERVICE_ACCOUNT di .env sudah benar dan menggunakan kutip tunggal di awal & akhir.");
}

module.exports = admin;