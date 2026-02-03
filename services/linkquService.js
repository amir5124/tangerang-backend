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
    // Mapping ke kode angka sesuai standar LinkQu
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

    const selectedBankCode = bankMapping[d.method.toUpperCase()] || d.method;

    // Payload harus menggunakan "bank_code" sesuai contoh curl Anda
    const payload = {
        amount: d.amount,
        partner_reff: d.partner_reff,
        customer_id: String(d.customer_id || "CUST-001"),
        customer_name: d.nama.trim(),
        expired: d.expired,
        customer_phone: d.wa || "081234567890",
        customer_email: d.email,
        bank_code: selectedBankCode, // MENGGUNAKAN UNDERSCORE SESUAI CURL
        remark: "Pembayaran Order " + d.partner_reff,
        url_callback: "https://backend.tangerangfast.online/api/payment/callback"
    };

    // rawSig harus urut: amount + expired + bank_code + partner_reff + nama + nama + email + client_id
    const rawSig = payload.amount + payload.expired + payload.bank_code + payload.partner_reff + payload.customer_name + payload.customer_name + payload.customer_email + LINKQU_CLIENT_ID;

    return hitLinkQu('/transaction/create/va', payload, rawSig);
};

exports.createQRIS = (d) => {
    const payload = {
        amount: d.amount,
        partner_reff: d.partner_reff,
        customer_id: String(d.customer_id || "CUST-001"),
        customer_name: d.nama.trim(),
        customer_phone: d.wa || "081234567890",
        customer_email: d.email,
        expired: d.expired,
        url_callback: "https://backend.tangerangfast.online/api/payment/callback"
    };

    const rawSig = payload.amount + payload.expired + payload.partner_reff + payload.customer_name + payload.customer_name + payload.customer_email + LINKQU_CLIENT_ID;

    return hitLinkQu('/transaction/create/qris', payload, rawSig);
};

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
        throw error;
    }
};