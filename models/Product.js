const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    required: true,
    enum: ["Bottle", "Raw Material"],
  },
  category: {
    type: String,
    required: true,
    validate: {
      validator: function (value) {
        if (this.type === "Bottle") {
          return [
            "200ml",
            "250ml",
            "500ml",
            "700ml",
            "900ml",
            "1L",
            "2L",
            "5L",
          ].includes(value);
        } else if (this.type === "Raw Material") {
          return [
            "25 mm Plastic ROPP Cap",
            "Narrow Neck Cap",
            "Pet Preforms",
            "26/22 Shortneck caps",
            "27mm Alaska caps",
          ].includes(value);
        }
        return false;
      },
      message: "Invalid category for the selected type",
    },
  },
  description: String,
  originalPrice: {
    type: Number,
    required: true,
    min: 0,
  },
  discountedPrice: {
    type: Number,
    min: 0,
  },
  boxes: {
    type: Number,
    required: true,
    // min: 0
  },
  bottlesPerBox: {
    type: Number,
    min: 1,
  },
  preformGramage: {
    type: Number,
    default: 0,
  },
  image: String,
  isActive: {
    type: Boolean,
    default: true,
  },
  validFrom: {
    type: Date,
    required: function () {
      return Boolean(this.discountedPrice);
    },
  },
  validTo: {
    type: Date,
    required: function () {
      return Boolean(this.discountedPrice);
    },
  },
  stockRemarks: [
    {
      message: String,
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      boxes: Number,
      changeType: String,
      updatedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

productSchema.virtual("discountPercentage").get(function () {
  if (this.discountedPrice && this.originalPrice) {
    const discount =
      ((this.originalPrice - this.discountedPrice) / this.originalPrice) * 100;
    return Math.round(discount);
  }
  return 0;
});

productSchema.virtual("isOffer").get(function () {
  if (!this.discountedPrice || !this.validFrom || !this.validTo) {
    return false;
  }
  const now = new Date();
  return (
    this.discountedPrice < this.originalPrice &&
    now >= this.validFrom &&
    now <= this.validTo
  );
});

productSchema.statics.getCategoriesByType = function (type) {
  if (type === "Bottle") {
    return ["200ml", "250ml", "500ml", "700ml","900ml", "1L", "2L", "5L"];
  } else if (type === "Raw Material") {
    return [
      "25 mm Plastic ROPP Cap",
      "Narrow Neck Cap",
      "Pet Preforms",
      "26/22 Shortneck caps",
      "27mm Alaska caps",
    ];
  }
  return [];
};

productSchema.set("toJSON", {
  virtuals: true,
  transform: function (doc, ret) {
    const now = new Date();
    const isValidOffer =
      ret.discountedPrice &&
      ret.validFrom &&
      ret.validTo &&
      now >= ret.validFrom &&
      now <= ret.validTo;

    ret.price = isValidOffer ? ret.discountedPrice : ret.originalPrice;

    if (isValidOffer) {
      ret.discountTag = `${ret.discountPercentage}% OFF`;
      ret.offerEndsIn = ret.validTo;
    } else {
      delete ret.discountedPrice;
      delete ret.discountPercentage;
      delete ret.discountTag;
      delete ret.offerEndsIn;
    }

    return ret;
  },
});

module.exports = mongoose.model("Product", productSchema);
