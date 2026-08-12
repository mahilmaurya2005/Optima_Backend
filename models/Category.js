const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema({
  type: { 
    type: String, 
    enum: ["Color", "Bottle Type", "Cap Type", "Preform Type"], 
    required: true 
  },
  name: { type: String, required: true },
  code: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Category", categorySchema);