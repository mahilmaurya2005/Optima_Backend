const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/auth");
const userController = require("../controllers/userController");
const cartController = require("../controllers/cartController");
const paymentController = require("../controllers/paymentController");
const upload = require("../config/multer");

router.get("/products", auth, userController.getAllProducts);
router.get("/offers", auth, userController.getOffers);

router.post("/cart", auth, cartController.addToCart);
router.get("/cart", auth, cartController.getCart);

router.delete("/cart/product", auth, cartController.removeFromCart);

router.post("/create-order", auth, paymentController.createOrder);

router.post(
  "/submit-payment-details",
  auth,
  upload.single("screenshot"),
  paymentController.submitPaymentDetails
);
router.get("/orders/history", auth, userController.getOrderHistory);

router.get("/profile", auth, userController.getProfile);
router.put("/profile", auth, userController.updateProfile);
router.post("/profile/change-password", auth, userController.changePassword);

router.get("/banners", auth, userController.getBanners);

router.get("/payments/:paymentId", auth, paymentController.getPaymentDetails);

module.exports = router;
