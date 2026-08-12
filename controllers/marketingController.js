const MarketingActivity = require("../models/MarketingActivity");
const cloudinary = require("../config/cloudinary");
const streamifier = require("streamifier");

const marketingController = {
  addActivity: async (req, res) => {
    try {
      const {
        customerName,
        customerMobile,
        discussion,
        location,
        visitType,
        inquiryType,
        remarks,
      } = req.body;

      if (
        !customerName ||
        !customerMobile ||
        !discussion ||
        !location ||
        !visitType
      ) {
        return res.status(400).json({
          error: "Missing required fields",
        });
      }

      if (!/^\d{10}$/.test(customerMobile)) {
        return res.status(400).json({
          error: "Please provide a valid 10-digit mobile number",
        });
      }

      if (!["on_field", "on_call"].includes(visitType)) {
        return res.status(400).json({
          error: 'Visit type must be either "on_field" or "on_call"',
        });
      }

      const uploadedFiles = req.files;

      if (uploadedFiles && uploadedFiles.length > 3) {
        return res.status(400).json({
          error: "Maximum 3 images allowed",
        });
      }

      const activity = new MarketingActivity({
        marketingUser: req.user._id,
        customerName,
        customerMobile,
        discussion,
        location,
        visitType,
        inquiryType: inquiryType || "",
        remarks: remarks || "",
        images: [],
      });

      if (uploadedFiles && uploadedFiles.length > 0) {
        try {
          const imageUploadPromises = uploadedFiles.map((file) => {
            return new Promise((resolve, reject) => {
              const uploadStream = cloudinary.uploader.upload_stream(
                {
                  folder: "marketing-activities",
                  allowed_formats: ["jpg", "jpeg", "png"],
                  resource_type: "auto",
                },
                (error, result) => {
                  if (error) reject(error);
                  else resolve(result.secure_url);
                }
              );

              streamifier.createReadStream(file.buffer).pipe(uploadStream);
            });
          });

          activity.images = await Promise.all(imageUploadPromises);
        } catch (uploadError) {
          console.error("Error uploading images:", uploadError);
          return res.status(400).json({
            error: "Error uploading images",
          });
        }
      }

      await activity.save();

      res.status(201).json({
        message: "Marketing activity logged successfully",
        activity,
      });
    } catch (error) {
      console.error("Error logging marketing activity:", error);
      res.status(500).json({
        error: "Error logging marketing activity",
      });
    }
  },

  getMyActivities: async (req, res) => {
    try {
      const activities = await MarketingActivity.find({
        marketingUser: req.user._id,
      })
        .sort({ createdAt: -1 })
        .populate("marketingUser", "name email")
        .populate("reviewedBy", "name role");

      res.json({ activities });
    } catch (error) {
      console.error("Error fetching marketing activities:", error);
      res.status(500).json({
        error: "Error fetching marketing activities",
      });
    }
  },

  getActivityById: async (req, res) => {
    try {
      const activity = await MarketingActivity.findById(req.params.activityId)
        .populate("marketingUser", "name email")
        .populate("reviewedBy", "name role");

      if (!activity) {
        return res.status(404).json({
          error: "Activity not found",
        });
      }

      res.json({ activity });
    } catch (error) {
      console.error("Error fetching activity details:", error);
      res.status(500).json({
        error: "Error fetching activity details",
      });
    }
  },
};

module.exports = marketingController;
