const express = require("express");
const router = express.Router();
const { auth, checkRole } = require("../middleware/auth");
const salesController = require("../controllers/salesController");

// Get all orders for sales
router.get(
  "/orders",
  auth,
  checkRole("sales"),
  salesController.getSalesOrders
);

// Approve
router.put(
  "/orders/:orderId/approve",
  auth,
  checkRole("sales"),
  salesController.approveOrder
);

// Reject
router.put(
  "/orders/:orderId/reject",
  auth,
  checkRole("sales"),
  salesController.rejectOrder
);

module.exports = router;