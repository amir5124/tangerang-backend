const moment = require('moment-timezone');
const crypto = require('crypto');

exports.formatWhatsApp = (phone) => {
    if (!phone) return "";
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '62' + cleaned.substring(1);
    else if (cleaned.startsWith('8')) cleaned = '62' + cleaned;
    return cleaned;
};

exports.generatePartnerReff = () => `INV-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

exports.getExpiredTimestamp = (min) => moment.tz('Asia/Jakarta').add(min, 'minutes').format('YYYYMMDDHHmmss');

exports.isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).toLowerCase());