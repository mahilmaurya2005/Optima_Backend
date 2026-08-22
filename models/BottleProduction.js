const mongoose = require("mongoose");

const bottleProductionSchema = new mongoose.Schema({
  preformType: { type: mongoose.Schema.Types.ObjectId, ref: "PreformType", required: true },
  
  producedBottles: [{
    bottleId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    bottleName: { type: String, required: true },
    boxesProduced: { type: Number, required: true, min: 0 },
    bottlesPerBox: { type: Number, required: true, min: 0 },
    preformGramage: { type: Number, required: true, min: 0 },
    totalBottles: { type: Number, required: true, min: 0 },
    labelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Label",
      required: true
    },
    capId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cap",
      required: true
    }
  }],

  bottleRejectionKg: { type: Number, default: 0, min: 0 },
  preformRejectionKg: { type: Number, default: 0, min: 0 },
  totalPreformUsedKg: { type: Number, required: true, min: 0 }, // X + Y + Z
  
  details: {
    totalBottles: { type: Number, default: 0 }, // Optional: sum of all produced
    shrinkRollUsed: { type: Number, default: 0 },
    preformBatchUsage: [{
      batchId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PreformProduction"
      },
      quantityUsed: { type: Number },
      productionDate: { type: Date }
    }]
  },
  remarks: { type: String },
  productionDate: { type: Date, default: Date.now },
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("BottleProduction", bottleProductionSchema);