const mongoose = require("mongoose");

const preformProductionLogSchema = new mongoose.Schema({
    preformProductionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PreformProduction",
        required: true,
        index: true
    },

    preformType: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },

    rawMaterials: [
        {
            material: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "RawMaterial",
                required: true
            },
            quantityUsed: {
                type: Number,
                required: true
            }
        }
    ],

    quantityProduced: {
        type: Number,
        required: true
    },

    wastageType1: {
        type: Number,
        default: 0
    },

    wastageType2: {
        type: Number,
        default: 0
    },

    totalWastage: {
        type: Number,
        default: 0
    },

    remarks: {
        type: String
    },

    productionDate: {
        type: Date,
        required: true
    },

    recordedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("Preform-Production-Logs", preformProductionLogSchema)