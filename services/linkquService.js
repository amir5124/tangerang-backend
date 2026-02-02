const axios = require('axios');
const crypto = require('crypto');

const { LINKQU_CLIENT_ID, LINKQU_CLIENT_SECRET, LINKQU_SERVER_KEY, LINKQU_USERNAME, LINKQU_PIN } = process.env;

const hitLinkQu = async (endpoint, data, rawSig) => {
    const signature = crypto.createHmac("sha256", LINKQU_SERVER_KEY)
        .update(endpoint + 'POST' + rawSig.replace(/[^0-9a-zA-Z]/g, "").toLowerCase())
        .digest("hex");

    return await axios.post(`https://api.linkqu.id/linkqu-partner${endpoint}`, {
        ...data,
        username: LINKQU_USERNAME,
        pin: LINKQU_PIN,
        signature
    }, {
        headers: { 'client-id': LINKQU_CLIENT_ID, 'client-secret': LINKQU_CLIENT_SECRET }
    });
};

exports.createVA = (d) => {
    const rawSig = d.amount + d.expired + d.method + d.partner_reff + d.nama + d.nama + d.email + LINKQU_CLIENT_ID;
    return hitLinkQu('/transaction/create/va', d, rawSig);
};

exports.createQRIS = (d) => {
    const rawSig = d.amount + d.expired + d.partner_reff + d.nama + d.nama + d.email + LINKQU_CLIENT_ID;
    return hitLinkQu('/transaction/create/qris', d, rawSig);
};