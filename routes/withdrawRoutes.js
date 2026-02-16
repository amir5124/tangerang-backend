const express = require("express");
const router = express.Router();
const withdrawController = require("../controllers/withdrawController");

// Step 1: Inquiry (Cek data & biaya)
router.post("/inquiry", withdrawController.inquiryWithdraw);

// Step 2: Payment (Eksekusi tarik saldo & potong wallet)
router.post("/execute", withdrawController.executeWithdraw);

module.exports = router;