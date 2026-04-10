const express = require("express");
const router = express.Router();
const withdrawController = require("../controllers/withdrawController");

router.post("/inquiry", withdrawController.inquiryWithdraw);

router.post("/execute", withdrawController.executeWithdraw);
router.post("/callback", withdrawController.handleWithdrawCallback);
router.get("/history/:user_id", withdrawController.getHistoryByUser);
router.get("/admin/all-history", withdrawController.getAllHistory);

module.exports = router;