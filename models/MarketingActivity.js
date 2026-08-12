const mongoose = require("mongoose");

const marketingActivitySchema = new mongoose.Schema({
  marketingUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  customerName: {
    type: String,
    required: true,
  },
  customerMobile: {
    type: String,
    required: true,
    match: [/^\d{10}$/, "Please enter a valid 10-digit mobile number"],
  },
  discussion: {
    type: String,
    required: true,
  },
  location: {
    type: String,
    required: true,
  },
  visitType: {
    type: String,
    enum: ["on_field", "on_call"],
    required: true,
  },
  inquiryType: {
    type: String,
    required: false,
  },
  remarks: {
    type: String,
    required: false,
  },
  images: [
    {
      type: String,
      required: false,
    },
  ],
  status: {
    type: String,
    enum: ["pending", "reviewed"],
    default: "pending",
  },
  reviewedAt: Date,
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("MarketingActivity", marketingActivitySchema);
