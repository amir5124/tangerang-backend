const db = require('../config/db');
const axios = require("axios");
const { LINKQU_CONFIG, E_WALLET_CODES, VA_CODES, generateSignature, logToFile } = require("../utils/linkquHelper");

exports.inquiryWithdraw = async (req, res) => {
    const { user_id, amount, bank_code, account_number } = req.body;

    try {
        // 1. Cek Saldo Internal
        const [wallet] = await db.query("SELECT balance FROM wallets WHERE user_id = ?", [user_id]);
        if (!wallet.length || wallet[0].balance < amount) {
            return res.status(400).json({ success: false, message: "Saldo tidak mencukupi" });
        }

        const idtrx = `INQ${Date.now()}`;
        const isEwallet = E_WALLET_CODES.includes(bank_code.toUpperCase());
        const isVA = VA_CODES.includes(bank_code.toUpperCase());

        let endpoint, method, signature;

        if (isEwallet) {
            endpoint = "/transaction/reload/inquiry";
            method = "GET";
        } else if (isVA) {
            endpoint = "/transaction/transferva/inquiry";
            method = "POST";
        } else {
            endpoint = "/transaction/withdraw/inquiry";
            method = "POST";
        }

        signature = generateSignature(endpoint, method, {
            amount, accountnumber: account_number, bankcode: bank_code, partnerreff: idtrx
        });

        const payload = {
            username: LINKQU_CONFIG.username,
            pin: LINKQU_CONFIG.pin,
            bankcode: bank_code,
            accountnumber: account_number,
            amount,
            partner_reff: idtrx,
            signature
        };

        let response;
        if (method === "GET") {
            response = await axios.get(`${LINKQU_CONFIG.baseUrl}${endpoint}`, {
                params: payload,
                headers: { "client-id": LINKQU_CONFIG.clientId, "client-secret": LINKQU_CONFIG.clientSecret }
            });
        } else {
            response = await axios.post(`${LINKQU_CONFIG.baseUrl}${endpoint}`, payload, {
                headers: { "client-id": LINKQU_CONFIG.clientId, "client-secret": LINKQU_CONFIG.clientSecret }
            });
        }

        // Simpan ke tabel inquiries untuk referensi payment
        await db.execute(
            "INSERT INTO inquiries (inquiry_reff, partner_reff, bankcode, accountnumber, amount, user_id) VALUES (?,?,?,?,?,?)",
            [response.data.inquiry_reff, idtrx, bank_code, account_number, amount, user_id]
        );

        res.json({ success: true, data: response.data });
    } catch (error) {
        logToFile("Inquiry Error", error.response?.data || error.message);
        res.status(500).json({ success: false, message: "Gagal Inquiry", error: error.response?.data });
    }
};

exports.executeWithdraw = async (req, res) => {
    const { inquiry_reff, user_id } = req.body;

    try {
        // 1. Ambil data inquiry
        const [inqData] = await db.query("SELECT * FROM inquiries WHERE inquiry_reff = ? AND user_id = ?", [inquiry_reff, user_id]);
        if (!inqData.length) return res.status(404).json({ success: false, message: "Data inquiry tidak ditemukan" });

        const data = inqData[0];
        const idtrxPay = `PAY${Date.now()}`;

        // Tentukan endpoint berdasarkan bankcode
        let endpoint = "/transaction/withdraw/payment";
        if (E_WALLET_CODES.includes(data.bankcode.toUpperCase())) endpoint = "/transaction/reload/payment";
        if (VA_CODES.includes(data.bankcode.toUpperCase())) endpoint = "/transaction/transferva/payment";

        const signature = generateSignature(endpoint, "POST", {
            amount: data.amount,
            accountnumber: data.accountnumber,
            bankcode: data.bankcode,
            partnerreff: idtrxPay,
            inquiryreff: inquiry_reff
        });

        const payload = {
            username: LINKQU_CONFIG.username,
            pin: LINKQU_CONFIG.pin,
            bankcode: data.bankcode,
            accountnumber: data.accountnumber,
            amount: data.amount,
            partner_reff: idtrxPay,
            inquiry_reff: inquiry_reff,
            signature,
            remark: "Withdraw App",
            url_callback: "https://yourdomain.com/api/withdraw/callback"
        };

        const response = await axios.post(`${LINKQU_CONFIG.baseUrl}${endpoint}`, payload, {
            headers: { "client-id": LINKQU_CONFIG.clientId, "client-secret": LINKQU_CONFIG.clientSecret }
        });

        if (response.data.status === "SUCCESS" || response.data.response_code === "00") {
            // POTONG SALDO WALLET
            await db.execute("UPDATE wallets SET balance = balance - ? WHERE user_id = ?", [data.amount, user_id]);

            // Catat transaksi
            await db.execute(
                "INSERT INTO transfers (inquiry_reff, partner_reff, amount, user_id, status) VALUES (?,?,?,?,?)",
                [inquiry_reff, idtrxPay, data.amount, user_id, "SUCCESS"]
            );
        }

        res.json({ success: true, data: response.data });
    } catch (error) {
        logToFile("Payment Error", error.response?.data || error.message);
        res.status(500).json({ success: false, message: "Gagal memproses penarikan" });
    }
};