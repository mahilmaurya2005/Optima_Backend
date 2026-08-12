const mongoose = require("mongoose");

const outcomeDetailSchema = new mongoose.Schema({
  outcomeItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "OutcomeItem",
    required: true,
  },
  quantityCreatedKg: { type: Number, required: true, min: 0 },
});

const productionOutcomeSchema = new mongoose.Schema({
  rawMaterials: [
    {
      material: { type: mongoose.Schema.Types.ObjectId, ref: "RawMaterial" },
      quantityUsed: { type: Number, required: true, min: 0 },
    },
  ],
  usedRawMaterialKg: { type: Number, required: true, min: 0 },
  outcomes: [outcomeDetailSchema],
  wastageKg: { type: Number, required: true, min: 0 },
  remarks: { type: String },
  productionDate: { type: Date, default: Date.now },
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
});

module.exports = mongoose.model("ProductionOutcome", productionOutcomeSchema);
