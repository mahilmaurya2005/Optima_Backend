const mongoose = require("mongoose");

const rawMaterialUsageSchema = new mongoose.Schema({
  material: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "RawMaterial",
    required: true,
  },
  quantityUsed: { type: Number, required: true, min: 0 },
});

const preformProductionSchema = new mongoose.Schema({
  type: { type: String, default: "preform" },
  rawMaterials: [rawMaterialUsageSchema],
  outcomeType: { type: String, required: true, lowercase: true, trim: true }, // e.g., "500ml", "1L"   
  quantityProduced: { type: Number, required: true, min: 0 },
  wastageKg: { type: Number, default: 0, min: 0 }, // Total wastage
  wastageType1: { type: Number, default: 0, min: 0 }, // Reusable wastage
  wastageType2: { type: Number, default: 0, min: 0 }, // Non-reusable/Scrap
  remarks: { type: String },
  productionDate: { type: Date, default: Date.now },
  usedInBottles: { type: Number, default: 0 },
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: { type: Date, default: Date.now }
});

// Ensure outcomeType values are unique (if needed)
preformProductionSchema.index({ outcomeType: 1, productionDate: 1 }, { unique: true });

module.exports = mongoose.model("PreformProduction", preformProductionSchema);