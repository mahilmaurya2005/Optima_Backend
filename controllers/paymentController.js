const Payment = require("../models/Payment");
const Cart = require("../models/Cart");
const Order = require("../models/Order");
const User = require("../models/User");
const Product = require("../models/Product");
const UserActivity = require("../models/UserActivity");
const cloudinary = require("../config/cloudinary");
const streamifier = require("streamifier");

const streamUpload = (file, folder) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
      },
      (error, result) => {
        if (result) resolve(result);
        else reject(error);
      }
    );

    stream.end(file.buffer); // ✅ IMPORTANT
  });
};

const isAhmedabadOrGandhinagar = (pinCode) => {
  const pin = Number(pinCode);
  return (pin >= 380001 && pin <= 382481) || (pin >= 382010 && pin <= 382855);
};

const calculateDeliveryCharge = (boxes, deliveryChoice, pinCode) => {
  if (
    deliveryChoice === "companyPickup" ||
    !isAhmedabadOrGandhinagar(pinCode)
  ) {
    return 0;
  }
  return boxes >= 230 && boxes <= 299 ? boxes * 2 : boxes * 3;
};

const paymentController = {
  async createOrder(req, res) {
    try {
      const userId = req.user._id;

      const {
        products,
        paymentMethod,
        shippingAddress,
        deliveryChoice
      } = req.body;

      // ✅ Validation
      if (!products || !products.length) {
        return res.status(400).json({
          success: false,
          message: "Products are required"
        });
      }

      if (
        !shippingAddress ||
        !shippingAddress.address ||
        !shippingAddress.city ||
        !shippingAddress.state ||
        !shippingAddress.pinCode
      ) {
        return res.status(400).json({
          success: false,
          message: "Complete shipping address required"
        });
      }

      if (!/^\d{6}$/.test(shippingAddress.pinCode)) {
        return res.status(400).json({
          success: false,
          message: "Pin code must be 6 digits"
        });
      }

      if (!["homeDelivery", "companyPickup"].includes(deliveryChoice)) {
        return res.status(400).json({
          success: false,
          message: "Invalid delivery choice"
        });
      }

      const validPaymentMethods = ["UPI", "netBanking", "COD"];
      if (!validPaymentMethods.includes(paymentMethod)) {
        return res.status(400).json({
          success: false,
          message: "Invalid payment method"
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // =============================
      // 🧠 BUSINESS LOGIC
      // =============================

      let totalAmount = 0;
      let totalBoxes = 0;
      const orderProducts = [];
      const productTypes = new Set();

      for (const item of products) {
        const product = await Product.findById(item.productId);

        if (!product || !product.isActive) {
          return res.status(404).json({
            success: false,
            message: `Product not found: ${item.productId}`
          });
        }

        const boxes = Number(item.boxes);
        if (boxes < 1) {
          return res.status(400).json({
            success: false,
            message: "Minimum 1 box required"
          });
        }

        totalBoxes += boxes;

        const price = product.discountedPrice || product.originalPrice;

        totalAmount += price * boxes;

        orderProducts.push({
          product: product._id,
          boxes,
          price,
          originalPrice: product.originalPrice
        });

        productTypes.add(product.type);

        // 🔥 STOCK REDUCE
        product.boxes -= boxes;

        product.stockRemarks.push({
          message: `Order placed: ${boxes} boxes deducted`,
          updatedBy: userId,
          boxes: -boxes,
          changeType: "order"
        });

        await product.save();
      }

      // =============================
      // 💰 CHARGES
      // =============================

      const deliveryCharge = 0;
      const GST_PERCENTAGE = 5;
      const gstAmount = (totalAmount * GST_PERCENTAGE) / 100;

      // =============================
      // 🧾 ORDER CREATE
      // =============================

      const order = new Order({
        user: userId,
        products: orderProducts,
        totalAmount,
        gst: gstAmount,
        deliveryCharge,
        totalAmountWithDelivery: totalAmount + deliveryCharge + gstAmount,
        paymentMethod,
        paymentStatus: "pending",
        orderStatus: "pending",
        type: [...productTypes][0],
        shippingAddress,
        deliveryChoice,
        firmName: user.customerDetails.firmName,
        gstNumber: user.customerDetails.gstNumber
      });

      await order.save();

      const payment = new Payment({
        user: userId,
        amount: totalAmount + deliveryCharge + gstAmount,
        status: "pending",
        userActivityStatus: user.isActive ? "active" : "inactive",
        orderDetails: order._id
      });

      await payment.save();

      // ======================================================
      // 🔥 NEW LOGIC: CLEAR CART AFTER ORDER
      // ======================================================

      await Cart.findOneAndUpdate(
        { user: userId },
        { $set: { products: [] } }
      );

      // ======================================================

      return res.status(201).json({
        success: true,
        message:
          paymentMethod === "COD"
            ? "Order placed successfully"
            : "Order created, complete payment",
        order,
        paymentId: payment._id,
        amount: totalAmount + deliveryCharge + gstAmount,
        gst: gstAmount,
        totalBoxes
      });

    } catch (error) {
      console.error("User Order Error:", error);
      return res.status(500).json({
        success: false,
        message: "Error creating order",
        error: error.message
      });
    }
  },

  submitPaymentDetails: async (req, res) => {
    try {
      const {
        paymentId,
        referenceId,
        submittedAmount,
        paymentType,
        paymentMode,
      } = req.body;

      if (!paymentId || !submittedAmount || !paymentType || !paymentMode) {
        return res.status(400).json({
          error: "paymentId, amount, paymentType and paymentMode required",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: "Screenshot is required",
        });
      }

      const numericSubmittedAmount = Number(submittedAmount);
      if (isNaN(numericSubmittedAmount) || numericSubmittedAmount <= 0) {
        return res.status(400).json({ error: "Invalid amount" });
      }

      const payment = await Payment.findById(paymentId);
      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }

      if (payment.status === "completed") {
        return res.status(400).json({ error: "Payment already completed" });
      }

      // ✅ Default bank
      const bankName = "IDFC";

      // ✅ Upload (SAFE)
      let cloudinaryResponse;
      try {
        cloudinaryResponse = await streamUpload(
          req.file,
          "payment-screenshots"
        );
      } catch (err) {
        console.error("Cloudinary Error:", err);
        return res.status(400).json({
          error: "Image upload failed",
        });
      }

      // ✅ Save history
      payment.paymentHistory.push({
        referenceId,
        paymentMode,
        bankName,
        screenshotUrl: cloudinaryResponse.secure_url,
        submittedAmount: numericSubmittedAmount,
        status: "submitted",
      });

      // ✅ Update amount
      payment.paidAmount += numericSubmittedAmount;

      // ✅ Update status
      if (payment.paidAmount === 0) payment.status = "pending";
      else if (payment.paidAmount < payment.amount) payment.status = "partial";
      else payment.status = "completed";

      await payment.save();

      // ✅ Order + Cart
      if (payment.orderDetails) {
        const order = await Order.findById(payment.orderDetails);

        if (order) {
          order.orderStatus = "pending";
          await order.save();

          await Cart.findOneAndUpdate(
            { user: order.user },
            { $set: { products: [] } }
          );
        }
      }

      res.json({
        success: true,
        message: "Payment submitted successfully",
        payment,
      });

    } catch (error) {
      console.error("Payment submission error:", error);
      res.status(500).json({
        error: error.message,
      });
    }
  },

  verifyPaymentByReception: async (req, res) => {
    try {
      const { paymentId, referenceId, verifiedAmount, verificationNotes } =
        req.body;
      if (!paymentId || !referenceId || verifiedAmount === undefined) {
        return res.status(400).json({
          error: "Payment ID, reference ID, and verified amount are required",
        });
      }

      const numericVerifiedAmount = Number(verifiedAmount);
      if (isNaN(numericVerifiedAmount) || numericVerifiedAmount < 0) {
        return res.status(400).json({ error: "Invalid verified amount" });
      }

      const payment = await Payment.findById(paymentId).populate(
        "orderDetails"
      );
      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }

      const paymentEntry = payment.paymentHistory.find(
        (entry) =>
          entry.referenceId === referenceId && entry.status === "submitted"
      );
      if (!paymentEntry) {
        return res.status(404).json({
          error: "Payment entry not found or already processed",
        });
      }

      if (numericVerifiedAmount > paymentEntry.submittedAmount) {
        return res.status(400).json({
          error: `Verified amount (${numericVerifiedAmount}) exceeds submitted amount (${paymentEntry.submittedAmount})`,
        });
      }

      const potentialPaidAmount = payment.paidAmount + numericVerifiedAmount;
      if (potentialPaidAmount > payment.amount) {
        return res.status(400).json({
          error: `Total paid amount (${potentialPaidAmount}) would exceed order amount (${payment.amount})`,
        });
      }

      paymentEntry.status = "verified";
      paymentEntry.verifiedAmount = numericVerifiedAmount;
      paymentEntry.verifiedBy = req.user._id;
      paymentEntry.verificationNotes = verificationNotes || "";
      paymentEntry.verificationDate = new Date();

      payment.paidAmount += numericVerifiedAmount;

      if (payment.paidAmount >= payment.amount) {
        payment.status = "completed";
        payment.orderDetails.paymentStatus = "completed";
        payment.orderDetails.orderStatus = "processing";
      } else {
        payment.status = "pending";
        payment.orderDetails.paymentStatus = "pending";
      }

      await payment.save();
      await payment.orderDetails.save();

      res.status(200).json({
        success: true,
        message: `Payment ${payment.status === "completed" ? "fully" : "partially"
          } verified`,
        payment: {
          ...payment.toObject(),
          amount: Number(payment.amount),
          paidAmount: Number(payment.paidAmount),
          remainingAmount: Number(payment.remainingAmount),
        },
        order: {
          ...payment.orderDetails.toObject(),
          totalAmountWithDelivery: Number(
            payment.orderDetails.totalAmountWithDelivery
          ),
        },
      });
    } catch (error) {
      console.error("Payment verification error:", error);
      res.status(500).json({
        error: "Error verifying payment",
        details: error.message,
      });
    }
  },

  getPaymentDetails: async (req, res) => {
    try {
      const paymentId = req.params.paymentId;
      const userId = req.user._id;

      const payment = await Payment.findById(paymentId)
        .populate("user", "name email phoneNumber")
        .populate("orderDetails");

      if (!payment) {
        return res.status(404).json({
          error: "Payment not found",
        });
      }

      if (payment.user._id.toString() !== userId.toString()) {
        return res.status(403).json({
          error: "Unauthorized access to payment details",
        });
      }

      res.status(200).json({
        success: true,
        payment: {
          _id: payment._id,
          user: payment.user,
          amount: payment.amount,
          paidAmount: payment.paidAmount,
          remainingAmount: payment.remainingAmount,
          status: payment.status,
          paymentHistory: payment.paymentHistory,
          orderDetails: payment.orderDetails,
          createdAt: payment.createdAt,
        },
      });
    } catch (error) {
      console.error("Payment details error:", error);
      res.status(500).json({
        error: "Error fetching payment details",
        details: error.message,
      });
    }
  },
};

module.exports = paymentController;
