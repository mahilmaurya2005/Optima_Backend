const express = require("express");
const router = express.Router();
const stockController = require("../controllers/stockController");
const { auth, checkRole } = require("../middleware/auth");
const upload = require("../config/multer");

router.use(auth, checkRole("stock"));

// ============= PRODUCT MANAGEMENT =============
router.get("/products", stockController.getAllProducts);
router.put("/update-quantity", stockController.updateQuantity);
router.get("/history/:productId", stockController.getStockHistory);
router.get("/history", stockController.getallStockHistory);

// ============= ATTENDANCE =============
router.post("/check-in", upload.single("checkInImage"), stockController.checkIn);
router.post("/check-out", stockController.checkOut);
router.get("/daily-updates", stockController.getDailyStockUpdates);

// ============= RAW MATERIAL MANAGEMENT =============
router.post("/raw-material/add", stockController.addRawMaterialItem);
router.put("/raw-material/:id", stockController.updateRawMaterial);
router.delete("/raw-material/:id", stockController.deleteRawMaterial);
router.get("/raw-materials", stockController.getRawMaterials);
router.get("/raw-material/entries", stockController.getRawMaterialEntries);
router.get("/raw-material/:id", stockController.getRawMaterialById);
router.put("/raw-material/:id/stock", stockController.updateRawMaterialStock);
router.get("/current-stock", stockController.getCurrentStock);
router.post("/raw-material/entry", stockController.addRawMaterialEntry);

// ============= LABEL MANAGEMENT =============
router.post("/label/add", stockController.addLabel);
router.put("/label/:id/stock", stockController.updateLabelStock);
router.get("/labels", stockController.getLabels);
router.get("/label/:id/history", stockController.getLabelHistory);
router.delete("/label/:id", stockController.deleteLabel);

// ============= CAP MANAGEMENT =============
router.post("/cap/add", stockController.addCap);
router.put("/cap/:id/stock", stockController.updateCapStock);
router.get("/caps", stockController.getCaps);
router.get("/cap/:id/history", stockController.getCapHistory);
router.delete("/cap/:id", stockController.deleteCap);

// ============= PREFORM PRODUCTION =============
router.post("/production/preform", stockController.recordPreformProduction);
router.get("/production/preform", stockController.getPreformProductionsWithReport);
router.get("/production/preform/:id", stockController.getPreformProductionsLog)
router.get("/preforms/available-types", stockController.getAvailablePreformTypesForBottle);
router.get("/preforms/available", stockController.getAvailablePreforms);
router.get("/preforms/types", stockController.getPreformTypes);

// ============= CAP PRODUCTION =============
router.post("/production/cap", stockController.recordCapProduction);
router.get("/production/cap", stockController.getCapProductionsWithReport);
router.get("/caps/available", stockController.getAvailableCaps);
router.get("/caps/types", stockController.getCapTypes);

// ============= BOTTLE TYPE MANAGEMENT =============
router.post("/bottle-type/add", stockController.addBottleType);
router.patch("/bottle-type/:id", stockController.updateBottleType);
router.delete("/bottle-type/:id", stockController.deleteBottleType);
router.get("/bottle-type", stockController.getBottleTypes);

// ============= BOTTLE PRODUCTION =============
router.post("/production/bottle", stockController.recordBottleProduction);
router.get("/production/bottle/category", stockController.getBottleCategory)
router.get("/production/bottle", stockController.getBottleProductions);
router.post("/production/check-availability", stockController.checkMaterialAvailability);
router.get("/production/check-bottle-availability", stockController.checkBottleProductionAvailability);

// ============= PRODUCTION OUTCOME (GENERAL) =============
router.post("/production/outcome", stockController.recordProductionOutcome);
router.get("/production/outcomes", stockController.getProductionOutcomes);

// ============= OUTCOME ITEMS =============
router.post("/outcome-item/add", stockController.addOutcomeItem);
router.get("/outcome-items", stockController.getOutcomeItems);

// ============= WASTAGE MANAGEMENT =============
router.post("/wastage", stockController.recordWastage);
router.put("/wastage/reuse", stockController.reuseWastage);
router.get("/wastage-report", stockController.getWastageReport);

// ============= DIRECT USAGE =============
router.post("/direct-usage", stockController.recordDirectUsage);

// ============= REPORTING =============
router.get("/stock-report", stockController.getStockReport);
router.get("/production-report", stockController.getProductionReport);
router.get("/usage-report", stockController.getUsageReport);
router.get("/report/preform-production", stockController.getPreformProductionReport);
router.get("/report/cap-production", stockController.getCapProductionReport);

// ============= PRODUCTION BATCHES =============
router.get("/production/batches", stockController.getProductionBatchesForSelection);

// ============= INITIALIZATION =============
router.post("/initialize-materials", stockController.initializeMaterials);

router.post("/preform-type/add", stockController.addPreformType);
router.post("/preform-type/:id/adjust-stock", stockController.adjustPreformStock);
router.get("/preform-type/:id/history", stockController.getPreformTypeHistory);
router.patch("/preform-type/:id", stockController.updatePreformType);
router.delete("/preform-type/:id", stockController.deletePreformType);
router.get("/preform-type", stockController.getPreformTypes);
module.exports = router;