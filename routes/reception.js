const express = require("express");
const router = express.Router();
const { auth, checkRole, authWithReception } = require("../middleware/auth");
const upload = require("../config/multer");
const receptionController = require("../controllers/receptionController");
const paymentController = require("../controllers/paymentController");

router.use(auth, checkRole("reception"));

router.post(
  "/customers",
  upload.single("photo"),
  receptionController.createCustomer
);
router.get("/users", receptionController.getAllUsers);
router.get("/users/search", receptionController.searchUsers);
router.get("/orders/user/:userCode", receptionController.getOrdersByUser);
router.post(
  "/orders/add-delivery-charge",
  receptionController.addDeliveryCharge
);
router.get("/orders/history", receptionController.getOrderHistory);
router.get("/orders/pending", receptionController.getPendingOrders);
router.patch("/orders/:orderId/status", receptionController.updateOrderStatus);
router.post(
  "/check-in",
  upload.single("checkInImage"),
  receptionController.checkIn
);
router.post("/check-out", receptionController.checkOut);

router.post("/user-panel-access", receptionController.getUserPanelAccess);
router.post(
  "/miscellaneous-panel-access",
  receptionController.getMiscellaneousPanelAccess
);
router.get("/payments/submitted", receptionController.getSubmittedPayments);
router.post("/payments/verify", paymentController.verifyPaymentByReception);

const userPanelRouter = express.Router();
userPanelRouter.use(authWithReception);
userPanelRouter.get("/products", receptionController.getUserProducts);
userPanelRouter.post("/products/price-add",receptionController.addPrice)
userPanelRouter.post("/orders", receptionController.createOrderAsReception);
router.patch("/orders/:orderId/edit", receptionController.editOrder);

router.use("/user-panel", userPanelRouter);

router.get("/pending-payments-details", receptionController.getPendingPaymentsDetails);
router.patch(
  "/payments/:paymentId/verify-submitted",
  receptionController.verifySubmittedPayment
);
router.get("/payments/pending", receptionController.getPendingPayments);
router.get("/payments/submitted", receptionController.getSubmittedPayments);
router.get("/partial-payments", receptionController.getPartialPayments);
router.get("/payment/:paymentId", receptionController.getPaymentDetails);
router.patch("/payments/:paymentId/status", receptionController.updatePaymentStatus);
router.patch("/payments/:paymentId/verify", receptionController.verifyPayment);
router.get("/payments/pending/download", receptionController.downloadPendingPaymentsExcel);
router.get("/products/all", receptionController.getAllProductsForReception);
router.get("/orders/full/:userCode", receptionController.getFullOrdersByUser);
router.get("/orders/all", receptionController.getAllOrders);
module.exports = router;
