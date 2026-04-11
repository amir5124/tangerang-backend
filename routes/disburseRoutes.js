const express = require("express");
const router = express.Router();
const disburseController = require("../controllers/disburseController");

/**
 * TIPS: Letakkan route yang spesifik di ATAS 
 * dan route yang dinamis/ber-parameter di BAWAH.
 */

// 1. Endpoint untuk update nilai (POST atau PUT)
// Gunakan POST jika ini pembuatan data baru, atau PUT untuk update
router.put("/update", disburseController.updateSetting);

// 2. Endpoint untuk mengambil nilai berdasarkan key
// Parameter dinamis :key diletakkan terakhir agar tidak "memakan" route lain
router.get("/:key", disburseController.getSettingByKey);

module.exports = router;