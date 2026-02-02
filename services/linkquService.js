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

const hitLinkQu = async (endpoint, data, rawSig) => {
    // Generate Signature sesuai dokumentasi LinkQu
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

exports.createVA = (d) => {
    // LinkQu VA membutuhkan data customer yang lengkap
    const payload = {
        amount: d.amount,
        expired: d.expired,
        bankcode: d.method, // Misal: MANDIRI, BNI
        partner_reff: d.partner_reff,
        customer_id: String(d.customer_id || "CUST-001"), // Wajib diisi (Unique Id)
        customer_name: d.nama.trim(),
        customer_phone: d.wa || "081234567890",
        customer_email: d.email
    };

    const rawSig = payload.amount + payload.expired + payload.bankcode + payload.partner_reff + payload.customer_name + payload.customer_name + payload.customer_email + LINKQU_CLIENT_ID;

    return hitLinkQu('/transaction/create/va', payload, rawSig);
};

exports.createQRIS = (d) => {
    // LinkQu QRIS juga butuh customer info agar tidak "Empty Customer Unique Id"
    const payload = {
        amount: d.amount,
        partner_reff: d.partner_reff,
        customer_id: String(d.customer_id || "CUST-001"), // Sesuai error "Empty Customer Unique Id"
        customer_name: d.nama.trim(),
        customer_phone: d.wa || "081234567890",
        customer_email: d.email,
        expired: d.expired
    };

    const rawSig = payload.amount + payload.expired + payload.partner_reff + payload.customer_name + payload.customer_name + payload.customer_email + LINKQU_CLIENT_ID;

    return hitLinkQu('/transaction/create/qris', payload, rawSig);
};