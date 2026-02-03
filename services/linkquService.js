const axios = require('axios');
const crypto = require('crypto');

const {
    LINKQU_CLIENT_ID,
    LINKQU_CLIENT_SECRET,
    LINKQU_SERVER_KEY,
    LINKQU_USERNAME,
    LINKQU_PIN
} = process.env;

const BASE_URL = "https://api.linkqu.id/linkqu-partner";

/**
 * Fungsi internal untuk memukul API LinkQu dengan Signature HmacSha256
 */
const hitLinkQu = async (endpoint, data, rawSig) => {
    // Generate Signature: endpoint + POST + rawSig (clean alphanumeric lowercase)
    const signature = crypto.createHmac("sha256", LINKQU_SERVER_KEY)
        .update(endpoint + 'POST' + rawSig.replace(/[^0-9a-zA-Z]/g, "").toLowerCase())
        .digest("hex");

    return await axios.post(`${BASE_URL}${endpoint}`, {
        ...data,
        username: LINKQU_USERNAME,
        pin: LINKQU_PIN,
        signature
    }, {
        headers: {
            'client-id': LINKQU_CLIENT_ID,
            'client-secret': LINKQU_CLIENT_SECRET,
            'Content-Type': 'application/json'
        }
    });
};

/**
 * Membuat Virtual Account
 */
exports.createVA = (d) => {
    // Mapping label dari frontend ke Bank Code Angka yang diminta LinkQu
    const bankMapping = {
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

    // Jika d.method tidak ada di mapping, gunakan d.method aslinya
    const selectedBankCode = bankMapping[d.method.toUpperCase()] || d.method;

    const payload = {
        amount: d.amount,
        expired: d.expired,
        bankcode: selectedBankCode,
        partner_reff: d.partner_reff,
        customer_id: String(d.customer_id || "CUST-001"),
        customer_name: d.nama.trim(),
        customer_phone: d.wa || "081234567890",
        customer_email: d.email
    };

    // rawSig untuk VA
    const rawSig = payload.amount + payload.expired + payload.bankcode + payload.partner_reff + payload.customer_name + payload.customer_name + payload.customer_email + LINKQU_CLIENT_ID;

    return hitLinkQu('/transaction/create/va', payload, rawSig);
};

/**
 * Membuat QRIS
 */
exports.createQRIS = (d) => {
    const payload = {
        amount: d.amount,
        partner_reff: d.partner_reff,
        customer_id: String(d.customer_id || "CUST-001"),
        customer_name: d.nama.trim(),
        customer_phone: d.wa || "081234567890",
        customer_email: d.email,
        expired: d.expired
    };

    // rawSig untuk QRIS
    const rawSig = payload.amount + payload.expired + payload.partner_reff + payload.customer_name + payload.customer_name + payload.customer_email + LINKQU_CLIENT_ID;

    return hitLinkQu('/transaction/create/qris', payload, rawSig);
};

/**
 * Cek Status Pembayaran (Polling)
 */
exports.checkStatus = async (partnerReff) => {
    try {
        const response = await axios.get(`${BASE_URL}/transaction/payment/checkstatus`, {
            params: {
                username: LINKQU_USERNAME,
                partnerreff: partnerReff
            },
            headers: {
                'client-id': LINKQU_CLIENT_ID,
                'client-secret': LINKQU_CLIENT_SECRET
            }
        });
        return response.data;
    } catch (error) {
        console.error("LinkQu Check Status Error:", error.response?.data || error.message);
        throw error;
    }
};