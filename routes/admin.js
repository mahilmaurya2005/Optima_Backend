const express = require("express");
const router = express.Router();
const { auth, checkRole } = require("../middleware/auth");
const upload = require("../config/multer");
const adminController = require("../controllers/adminController");

router.use(auth, checkRole("admin"));

router.get("/dashboard/stats", adminController.getDashboardStats);
router.get("/categories", adminController.getCategories);

router.get("/users", adminController.getAllUsers);

router.patch(
  "/users/:userCode/toggle-status",
  adminController.toggleUserStatus
);
router.get("/users/:userId/activity", adminController.getUserActivityHistory);
router.get("/staff", adminController.getAllStaff);
router.delete("/staff/:staffId", adminController.deleteStaff);

router.get("/products", adminController.getAllProducts);
router.post("/products", upload.single("image"), adminController.createProduct);
router.put(
  "/products/:productId",
  upload.single("image"),
  adminController.updateProduct
);
router.delete("/products/:productId", adminController.deleteProduct);

router.get("/orders", adminController.getAllOrders);
router.get("/download-order-history", adminController.downloadOrderHistory);

router.get("/orders/preview", adminController.getPreviewOrders);
router.post("/orders/:orderId/process", adminController.processPreviewOrder);

router.get("/marketing-activities", adminController.getAllMarketingActivities);
router.patch(
  "/marketing-activities/:activityId/review",
  adminController.reviewMarketingActivity
);
router.get(
  "/download-marketing-activities",
  adminController.downloadAllMarketingActivities
);

router.get("/attendance", adminController.getAllAttendance);
router.get("/attendance-summary", adminController.getAttendanceSummary);
router.get("/check-in-images", adminController.getCheckInImages);

router.get("/profile", adminController.getAdminProfile);

router.get("/stock/full-history", adminController.getFullStockHistory);
router.get(
  "/stock/full-history/download",
  adminController.downloadFullStockHistory
);

router.post("/banners", upload.single("image"), adminController.uploadBanner);
router.put(
  "/banners/:bannerId",
  upload.single("image"),
  adminController.updateBanner
);
router.delete("/banners/:bannerId", adminController.deleteBanner);
router.get("/banners", adminController.getAllBanners);

// Admin Settings
router.post("/category", adminController.addCategory);
router.post("/formula", adminController.addFormula);
router.get("/categories", adminController.getCategories);
router.get("/formulas", adminController.getFormulas);
router.get("/export/stock-report", adminController.exportStockReport);
router.get("/export/production-report", adminController.exportProductionReport);
router.get("/export/wastage-report", adminController.exportWastageReport);
router.get("/raw-material/summary", adminController.getRawMaterialStockSummary);
router.get("/payments/history", adminController.getPaymentHistory);
router.delete("/users/:userCode", adminController.deleteUser);
router.get("/orders/filter", adminController.getFilteredOrders);
router.get("/challans", adminController.getAllChallans);
router.get("/stock/activities", adminController.getStockActivities);
router.get("/revenue/challan-report", adminController.getChallanRevenueReport);

module.exports = router;
