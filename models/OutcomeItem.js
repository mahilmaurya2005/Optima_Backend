const mongoose = require("mongoose");

const outcomeItemSchema = new mongoose.Schema({
  itemName: { type: String, required: true },
  itemCode: { type: String, required: true, unique: true },
  type: { type: String, enum: ["preform", "cap", "bottle"], required: true },
  subcategory: { type: String }, // e.g., "500ml", "1L", "28mm", "30mm"
  remarks: { type: String },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("OutcomeItem", outcomeItemSchema);