const express = require("express");
const router = express.Router();
const settingsController = require("../controllers/disburseController");

// Endpoint untuk mengambil nilai (misal: /api/settings/app_service_fee)
router.get("/:key", settingsController.getSettingByKey);

// Endpoint untuk update nilai
router.put("/update", settingsController.updateSetting);

module.exports = router;