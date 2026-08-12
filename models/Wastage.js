const mongoose = require("mongoose");

const wastageSchema = new mongoose.Schema({
  wastageType: { 
    type: String, 
    enum: ["Type 1: Reusable Wastage", "Type 2: Non-reusable / Scrap"], 
    required: true 
  },
  source: { 
    type: String, 
    enum: ["Preform", "Cap", "Bottle"], 
    required: true 
  },
  quantityGenerated: { type: Number, required: true, min: 0 },
  quantityReused: { type: Number, default: 0, min: 0 },
  quantityScrapped: { type: Number, default: 0, min: 0 },
  reuseReference: { type: String },
  date: { type: Date, default: Date.now },
  remarks: { type: String },
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
});

// Auto-calculate quantityScrapped before save
wastageSchema.pre("save", function(next) {
  this.quantityScrapped = this.quantityGenerated - this.quantityReused;
  next();
});

module.exports = mongoose.model("Wastage", wastageSchema);