const express = require("express");
const router = express.Router();
const { auth, checkRole } = require("../middleware/auth");
const marketingController = require("../controllers/marketingController");
const upload = require("../config/multer");

router.use(auth, checkRole("marketing"));

router.post(
  "/activities",
  upload.array("images", 3),
  marketingController.addActivity
);
router.get("/activities", marketingController.getMyActivities);
router.get("/activities/:activityId", marketingController.getActivityById);

module.exports = router;
