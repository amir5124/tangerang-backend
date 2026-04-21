const express = require("express");
const router = express.Router();
const withdrawController = require("../controllers/withdrawController");

// --- ROUTES UNTUK MITRA/USER BIASA ---

// 1. Inquiry penarikan dana mitra (Cek saldo & cek rekening)
router.post("/inquiry", withdrawController.inquiryWithdraw);

// 2. Eksekusi penarikan dana mitra (Potong saldo)
router.post("/execute", withdrawController.executeWithdraw);

// 3. Riwayat penarikan per user
router.get("/history/:user_id", withdrawController.getHistoryByUser);


// --- ROUTES KHUSUS ADMIN (BYPASS SALDO) ---

// 4. Inquiry penarikan dana Admin (Bebas tarik/tanpa cek saldo)
router.post("/admin-inquiry", withdrawController.adminInquiryWithdraw);

// 5. Eksekusi penarikan dana Admin (Tanpa potong saldo wallet)
router.post("/admin-execute", withdrawController.adminExecuteWithdraw);

// 6. Lihat semua riwayat penarikan (Untuk Dashboard Admin)
router.get("/admin/all-history", withdrawController.getAllHistory);


// --- WEBHOOK / CALLBACK ---

// 7. Callback dari LinkQu (Update status transaksi & potong saldo otomatis)
router.post("/callback", withdrawController.handleWithdrawCallback);

module.exports = router;