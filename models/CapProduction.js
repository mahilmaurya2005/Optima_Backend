const mongoose = require("mongoose");

const rawMaterialUsageCapSchema = new mongoose.Schema({
  material: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "RawMaterial",
    required: true,
  },
  quantityUsed: { type: Number, required: true, min: 0 },
});

const capProductionSchema = new mongoose.Schema({
  rawMaterials: [rawMaterialUsageCapSchema],
  capType: { type: String, required: true }, // e.g., "28mm", "30mm"
  capColor: {
    type: String,
    required: true,
    enum: ["White", "Blue", "Red", "Green", "Yellow", "Black", "Transparent", "Other"]
  },
  quantityProduced: { type: Number, required: true, min: 0 },
  packagingUsed: {
    boxes: { type: Number, default: 0 },
    bags: { type: Number, default: 0 }
  },
  wastage: { type: Number, default: 0, min: 0 }, // Total wastage
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

// Ensure unique category combinations
capProductionSchema.index({ capType: 1, capColor: 1, productionDate: 1 });

module.exports = mongoose.model("CapProduction", capProductionSchema);