const mongoose = require("mongoose");

const directUsageSchema = new mongoose.Schema({
  material: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "RawMaterial",
    required: true,
  },
  quantity: { type: Number, required: true, min: 0 },
  purpose: { type: String, required: true },
  usageDate: { type: Date, default: Date.now },
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  remarks: { type: String },
});

module.exports = mongoose.model("DirectUsage", directUsageSchema);