const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    unique: true,
    sparse: true,
  },
  password: {
    type: String,
    required: true,
  },
  phoneNumber: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: [
      "admin",
      "user",
      "reception",
      "stock",
      "dispatch",
      "marketing",
      "miscellaneous",
      "sales",
    ],
    default: "user",
  },
  isActive: {
    type: Boolean,
    default: true,
  },

  customerDetails: {
    firmName: {
      type: String,
      required: function () {
        return this.role === "user";
      },
    },
    gstNumber: String,
    panNumber: String,
    photo: String,
    address: {
      address: {
        type: String,
        required: function () {
          return this.role === "user";
        },
      },
      city: {
        type: String,
        required: function () {
          return this.role === "user";
        },
      },
      state: {
        type: String,
        required: function () {
          return this.role === "user";
        },
      },
      pinCode: {
        type: String,
        required: function () {
          return this.role === "user";
        },
        match: [/^\d{6}$/, "Pin code must be 6 digits"],
      },
    },
    userCode: {
      type: String,
      unique: true,
      sparse: true,
    },
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);

  if (this.role === "user" && !this.customerDetails.userCode) {
    this.customerDetails.userCode =
      "OPT" + Math.floor(1000 + Math.random() * 9000);
  }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
