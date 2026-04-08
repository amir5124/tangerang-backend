const db = require('../config/db');
const axios = require("axios");
const { 
    LINKQU_CONFIG, 
    E_WALLET_CODES, 
    VA_CODES, 
    generateSignature, 
    logToFile, 
    BANK_MAPPING 
} = require("../utils/linkquHelper");

// 1. INQUIRY WITHDRAW
exports.inquiryWithdraw = async (req, res) => {
    console.log("\n🚀 [DEBUG] === INQUIRY START ===");
    console.log("📥 Payload Masuk:", JSON.stringify(req.body, null, 2));

    const { user_id, amount, bank_code, account_number } = req.body;

    try {
        // Validasi input awal
        if (!user_id || !amount || !bank_code || !account_number) {
            console.log("❌ [ERROR] Input tidak lengkap");
            return res.status(400).json({ success: false, message: "Input tidak lengkap" });
        }

        // 1. Cek Saldo Internal di DB
        console.log(`🔍 Mencari wallet untuk user_id: ${user_id}`);
        const [wallet] = await db.query("SELECT balance FROM wallets WHERE user_id = ?", [user_id]);
        
        if (!wallet.length) {
            console.log("❌ [ERROR] Wallet tidak ditemukan di database untuk user ini");
            return res.status(404).json({ success: false, message: "Wallet tidak ditemukan" });
        }

        const currentBalance = wallet[0].balance;
        console.log(`💰 Saldo saat ini: ${currentBalance} | Amount diminta: ${amount}`);

        if (currentBalance < amount) {
            console.log("❌ [ERROR] Saldo tidak mencukupi");
            return res.status(400).json({ success: false, message: "Saldo tidak mencukupi" });
        }

        // 2. Persiapan Data LinkQu
        const idtrx = `INQ${Date.now()}`;
        const realBankCode = BANK_MAPPING[bank_code.toUpperCase()] || bank_code;
        console.log(`🏦 Mapping Bank: ${bank_code} -> ${realBankCode}`);

        const isEwallet = E_WALLET_CODES.includes(bank_code.toUpperCase());
        const isVA = VA_CODES.includes(bank_code.toUpperCase());

        let endpoint, method;
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

        console.log(`📡 Route: ${method} | Endpoint: ${endpoint}`);

        const signature = generateSignature(endpoint, method, {
            amount, accountnumber: account_number, bankcode: realBankCode, partnerreff: idtrx
        });
        console.log("🔑 Signature Generated:", signature);

        const payload = {
            username: LINKQU_CONFIG.username,
            pin: LINKQU_CONFIG.pin,
            bankcode: realBankCode,
            accountnumber: account_number,
            amount,
            partner_reff: idtrx,
            signature
        };

        const headers = { 
            "client-id": LINKQU_CONFIG.clientId, 
            "client-secret": LINKQU_CONFIG.clientSecret 
        };

        // 3. Request ke API LinkQu
        console.log(`🌐 Mengirim request ke: ${LINKQU_CONFIG.baseUrl}${endpoint}`);
        let response;
        if (method === "GET") {
            response = await axios.get(`${LINKQU_CONFIG.baseUrl}${endpoint}`, { params: payload, headers });
        } else {
            response = await axios.post(`${LINKQU_CONFIG.baseUrl}${endpoint}`, payload, { headers });
        }

        console.log("✅ [SUCCESS] Response LinkQu:", JSON.stringify(response.data, null, 2));

        // 4. Simpan ke Tabel Inquiries
        await db.execute(
            "INSERT INTO inquiries (inquiry_reff, partner_reff, bankcode, accountnumber, amount, user_id) VALUES (?,?,?,?,?,?)",
            [response.data.inquiry_reff, idtrx, realBankCode, account_number, amount, user_id]
        );
        console.log("💾 Data inquiry berhasil disimpan ke Database");

        res.json({ success: true, data: response.data });

    } catch (error) {
        console.log("💥 [FATAL ERROR] Inquiry Gagal");
        const errorData = error.response?.data || error.message;
        console.log("Detail Error:", JSON.stringify(errorData, null, 2));
        
        logToFile("Inquiry Error", errorData);
        res.status(500).json({ success: false, message: "Gagal Inquiry", error: errorData });
    }
};

// 2. EXECUTE WITHDRAW (PAYMENT)
exports.executeWithdraw = async (req, res) => {
    console.log("\n💸 [DEBUG] === EXECUTE WITHDRAW START ===");
    const { inquiry_reff, user_id } = req.body;
    console.log(`🎯 Ref: ${inquiry_reff} | User: ${user_id}`);

    try {
        const [inqData] = await db.query("SELECT * FROM inquiries WHERE inquiry_reff = ? AND user_id = ?", [inquiry_reff, user_id]);
        
        if (!inqData.length) {
            console.log("❌ [ERROR] Data inquiry tidak ditemukan di database");
            return res.status(404).json({ success: false, message: "Data inquiry tidak ditemukan" });
        }

        const data = inqData[0];
        const idtrxPay = `PAY${Date.now()}`;

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
            remark: "Withdraw Mitra",
            url_callback: "https://backend.tangerangfast.online/api/withdraw/callback"
        };

        console.log(`📡 Mengirim Payment ke: ${endpoint}`);
        const response = await axios.post(`${LINKQU_CONFIG.baseUrl}${endpoint}`, payload, {
            headers: { "client-id": LINKQU_CONFIG.clientId, "client-secret": LINKQU_CONFIG.clientSecret }
        });

        console.log("✅ [SUCCESS] Response Payment LinkQu:", JSON.stringify(response.data, null, 2));

        if (response.data.response_code === "00" || response.data.status === "SUCCESS" || response.data.status === "PENDING") {
            await db.execute(
                "INSERT INTO transfers (inquiry_reff, partner_reff, amount, user_id, status) VALUES (?,?,?,?,?)",
                [inquiry_reff, idtrxPay, data.amount, user_id, "PENDING"]
            );
            console.log("💾 Transaksi dicatat PENDING di Database");
        }

        res.json({ success: true, data: response.data });

    } catch (error) {
        console.log("💥 [FATAL ERROR] Payment Gagal");
        const errorData = error.response?.data || error.message;
        console.log("Detail Error:", JSON.stringify(errorData, null, 2));

        logToFile("Payment Error", errorData);
        res.status(500).json({ success: false, message: "Gagal memproses penarikan" });
    }
};

// 3. CALLBACK WITHDRAW (UPDATE SALDO MITRA)
exports.handleWithdrawCallback = async (req, res) => {
    console.log("\n🔔 [WEBHOOK] === CALLBACK RECEIVED ===");
    console.log("📥 Data Callback:", JSON.stringify(req.body, null, 2));

    const connection = await db.getConnection();
    try {
        const { partner_reff, status } = req.body;
        logToFile("Withdraw Webhook", req.body);

        if (status === 'SUCCESS' || status === 'SETTLED') {
            console.log(`🔄 Memproses transaksi sukses: ${partner_reff}`);
            await connection.beginTransaction();

            // 1. Ambil data transfer yang pending
            const [rows] = await connection.execute(
                "SELECT * FROM transfers WHERE partner_reff = ? AND status = 'PENDING'",
                [partner_reff]
            );

            if (rows.length > 0) {
                const transfer = rows[0];

                // 2. AMBIL BIAYA ADMIN DARI TABEL disburse_admin
                const [adminConfig] = await connection.execute(
                    "SELECT key_value FROM disburse_admin WHERE key_name = 'withdraw_fee' LIMIT 1"
                );

                // Default ke 0 jika tidak ditemukan di database, lalu konversi ke angka
                const withdrawFee = adminConfig.length > 0 ? parseInt(adminConfig[0].key_value) : 0;
                
                // 3. HITUNG TOTAL YANG HARUS DIPOTONG (Nominal Withdraw + Biaya Admin)
                const totalDebit = parseFloat(transfer.amount) + withdrawFee;

                console.log(`💸 Detail Potong Saldo: Nominal(${transfer.amount}) + Fee(${withdrawFee}) = Total(${totalDebit})`);
                console.log(`👤 User ID: ${transfer.user_id}`);

                // 4. Update Saldo Wallet (Potong sebesar totalDebit)
                const [updateWallet] = await connection.execute(
                    "UPDATE wallets SET balance = balance - ? WHERE user_id = ? AND balance >= ?",
                    [totalDebit, transfer.user_id, totalDebit]
                );

                if (updateWallet.affectedRows > 0) {
                    // 5. Update status transfer jadi SUCCESS
                    await connection.execute(
                        "UPDATE transfers SET status = 'SUCCESS', updated_at = NOW() WHERE partner_reff = ?",
                        [partner_reff]
                    );

                    await connection.commit();
                    console.log(`✅ [DONE] Saldo terpotong ${totalDebit} & Status SUCCESS untuk ${partner_reff}`);
                } else {
                    console.log("❌ [ERROR] Gagal potong saldo (mungkin saldo sudah tidak cukup untuk nominal + fee)");
                    throw new Error("Saldo tidak mencukupi saat callback (Nominal + Admin Fee)");
                }
            } else {
                console.log("⚠️ [WARN] Transaksi tidak ditemukan atau sudah tidak PENDING");
            }
        } else if (status === 'FAILED' || status === 'REJECTED') {
            console.log(`❌ [FAILED] Transaksi ditolak LinkQu: ${partner_reff}`);
            await connection.execute(
                "UPDATE transfers SET status = 'FAILED', updated_at = NOW() WHERE partner_reff = ?",
                [partner_reff]
            );
        }

        res.status(200).send("OK");
    } catch (err) {
        if (connection) await connection.rollback();
        console.log("💥 [FATAL ERROR] Callback Processing Failed:", err.message);
        logToFile("Callback Error", err.message);
        res.status(500).send("Internal Error");
    } finally {
        if (connection) connection.release();
    }
};