// config/firebaseConfig.js
const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("✅ Firebase Admin SDK Initialized");
} catch (error) {
    console.error("❌ Firebase Admin Initialization Error:", error);
}

module.exports = admin;