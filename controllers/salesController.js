const Order = require("../models/Order");
const User = require("../models/User");
const fs = require("fs").promises;
const path = require("path");
const jwt = require("jsonwebtoken");
const Attendance = require("../models/Attendance");
const cloudinary = require("../config/cloudinary");
const Counter = require("../models/Counter");
const Product = require("../models/Product");
const Payment = require("../models/Payment");
const streamifier = require("streamifier");
const mongoose = require("mongoose");
const ExcelJS = require("exceljs");
const roundAmount = require("../utils/roundAmount");

exports.getSalesOrders = async (req, res) => {
  try {
    const orders = await Order.find({ orderStatus: "sales_pending" })
      .populate(
        "user",
        "name phoneNumber email customerDetails.userCode customerDetails.firmName"
      )
      .populate("products.product")
      .sort({ createdAt: -1 });

    const formattedOrders = orders.map((order) => {
      const orderObj = order.toObject();

      const amount = Number(order.totalAmount || 0);
      const gst = Number((amount * 0.05).toFixed(2));
      const totalAmountWithGST = roundAmount(amount + gst);

      return {
        ...orderObj,

        // ✅ Safe access
        userCode: order.user?.customerDetails?.userCode || null,

        amount,
        gst,
        totalAmountWithGST,
      };
    });

    res.json({ orders: formattedOrders });

  } catch (error) {
    console.error("Error fetching sales orders:", error);
    res.status(500).json({ error: "Error fetching sales orders" });
  }
};

exports.approveOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    order.orderStatus = "approved_by_sales"; 
    order.salesApprovedBy = req.user._id;
    order.salesApprovedAt = new Date();

    await order.save();

    res.json({ message: "Order approved by sales" });
  } catch (error) {
    res.status(500).json({ error: "Error approving order" });
  }
};

// ❌ Reject Order
exports.rejectOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: "Rejection reason required" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    order.orderStatus = "rejected_by_sales";
    order.rejectionReason = reason;
    order.rejectedBy = req.user._id;

    await order.save();

    res.json({ message: "Order rejected by sales" });
  } catch (error) {
    res.status(500).json({ error: "Error rejecting order" });
  }
};
