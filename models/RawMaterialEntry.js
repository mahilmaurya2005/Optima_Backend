const mongoose = require("mongoose");

const rawMaterialEntrySchema = new mongoose.Schema({
  rawMaterial: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "RawMaterial",
    required: true,
  },
  quantityKg: { type: Number, required: true, min: 0 },
  remarks: { type: String },
  enteredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  entryDate: { type: Date, default: Date.now },
});

module.exports = mongoose.model("RawMaterialEntry", rawMaterialEntrySchema);