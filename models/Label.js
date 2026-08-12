const mongoose = require("mongoose");

const labelSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true
  },
  bottleCategory: { type: String, required: true },
  bottleName: { type: String, required: true },

  quantityAvailable: { 
    type: Number, 
    default: 0,
    min: 0 
  },

  remarks: { type: String },

  isActive: { default: true, type: Boolean },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  createdAt: { default: Date.now, type: Date },
  updatedAt: { default: Date.now, type: Date }
});

// Unique based on product
labelSchema.index({ product: 1 }, { unique: true });

// Update timestamp on save
labelSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("Label", labelSchema);