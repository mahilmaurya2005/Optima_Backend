const express = require("express");
const router = express.Router();
const { auth, checkRole } = require("../middleware/auth");
const upload = require("../config/multer");
const authController = require("../controllers/authController");
const adminController = require("../controllers/adminController");

router.post(
  "/register/customer",
  upload.single("photo"),
  authController.registerCustomer
);

router.put(
  "/profile/photo",
  auth,
  upload.single("photo"),
  authController.updateProfilePhoto
);

router.post("/register/first-admin", authController.registerFirstAdmin);

router.post(
  "/register/staff",
  auth,
  checkRole("admin"),
  authController.registerStaff
);
router.get("/staff", auth, checkRole("admin"), adminController.getAllStaff);

router.post("/login", authController.login);

router.get("/profile", auth, authController.getProfile);

module.exports = router;
