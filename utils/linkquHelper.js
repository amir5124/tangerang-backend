const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LINKQU_CONFIG = {
    username: process.env.LINKQU_USERNAME,
    pin: process.env.LINKQU_PIN,
    clientId: process.env.LINKQU_CLIENT_ID,
    clientSecret: process.env.LINKQU_CLIENT_SECRET,
    serverKey: process.env.LINKQU_SERVER_KEY,
    baseUrl: "https://api.linkqu.id/linkqu-partner",
};

const BANK_MAPPING = {
    'VA BRI': '002',
    'BRI': '002',
    'VA MANDIRI': '008',
    'MANDIRI': '008',
    'VA BNI': '009',
    'BNI': '009',
    'VA PERMATA': '013',
    'PERMATA': '013',
    'VA BCA': '014',
    'BCA': '014'
};

const E_WALLET_CODES = ['OVO', 'DANA', 'LINKAJA', 'GOPAY', 'SHOPEEPAY'];
const VA_CODES = ['BRIVA', 'BNIVA', 'MANDIRIVA', 'PERMATAVA'];

const logToFile = (title, message) => {
    try {
        const logDir = path.join(__dirname, '../logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        
        const logPath = path.join(logDir, 'linkqu.log');
        const timestamp = new Date().toLocaleString('id-ID');
        const logMessage = `[${timestamp}] === ${title} ===\n${JSON.stringify(message, null, 2)}\n------------------------------------------\n`;
        
        fs.appendFileSync(logPath, logMessage);
    } catch (err) {
        console.error("Log Error:", err);
    }
};

const generateSignature = (endpoint, method, data) => {
    const payload = JSON.stringify(data);
    return crypto
        .createHmac('sha256', LINKQU_CONFIG.clientSecret)
        .update(payload)
        .digest('hex');
};

module.exports = {
    LINKQU_CONFIG,
    BANK_MAPPING,
    E_WALLET_CODES,
    VA_CODES,
    generateSignature,
    logToFile
};