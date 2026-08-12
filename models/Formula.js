const mongoose = require("mongoose");

const formulaSchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g., "Shrink Roll per Box", "Labels per Bottle"
  formula: { type: String, required: true }, // e.g., "50" for 50gm per box
  unit: { type: String, required: true },
  description: { type: String },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Formula", formulaSchema);