const Order = require("../models/Order");
const User = require("../models/User");
const Attendance = require("../models/Attendance");
const cloudinary = require("../config/cloudinary");
const Challan = require("../models/Challan");
const generateChallanPDF = require("../utils/pdfgen");
const streamifier = require("streamifier");
const ExcelJS = require("exceljs");
const Payment = require("../models/Payment");
const sendMail = require("../utils/sendMail");
const mongoose = require("mongoose");
const updateOrderDeliveryCharge = require("../utils/updateOrderDeliveryCharge");
const roundAmount = require("../utils/roundAmount");
const {
  isAhmedabadOrGandhinagar,

} = require("./receptionController");
const Product = require("../models/Product");

const generateInvoiceNumber = async () => {
  const date = new Date();
  const currentYear = date.getFullYear();

  const latestChallan = await Challan.findOne().sort({ invoiceNo: -1 });

  let sequence = 122234192;
  if (latestChallan && latestChallan.invoiceNo) {
    sequence = parseInt(latestChallan.invoiceNo) + 1;
  }

  return sequence.toString();
};

const getFinancialYear = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  let startYear, endYear;

  if (month >= 4) {
    startYear = year;
    endYear = year + 1;
  } else {
    startYear = year - 1;
    endYear = year;
  }

  return `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
};

const Counter = require("../models/Counter");

const generateChallanNumber = async () => {
  const fy = getFinancialYear();

  const counterName = `challan_${fy}`;

  const counter = await Counter.findOneAndUpdate(
    { name: counterName },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  const paddedNumber = String(counter.seq).padStart(4, "0");

  return `${paddedNumber}/${fy}`;
};



exports.generateChallanFromOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const {
      splitInfo,
      extraItems,
      scheduledDates,
      deliveryChoice,
      shippingAddress,
      vehicleDetails,
      receiverName,
      deliveryCharge,
      deliveryChargePerBox
    } = req.body;

    const requestedDeliveryCharge =
      deliveryCharge !== undefined ? deliveryCharge : deliveryChargePerBox;

    const order = await Order.findById(orderId)
      .populate("user", "customerDetails.userCode email")
      .populate("products.product");

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const existingChallan = await Challan.findOne({ originalOrder: orderId });
    if (existingChallan) {
      return res.status(400).json({
        error: "Challan already generated",
      });
    }

    // ✅ VALIDATION (VERY IMPORTANT)
    const totalOrderBoxes = order.products.reduce((s, p) => s + p.boxes, 0);

    const totalDistributed = splitInfo.itemsDistribution
      .flat()
      .reduce((s, i) => s + i.boxes, 0);

    if (totalOrderBoxes !== totalDistributed) {
      return res.status(400).json({
        error: "Distributed boxes do not match order total",
      });
    }

    const numberOfChallans = splitInfo?.numberOfChallans || 1;

    const generatedChallans = [];

    for (let i = 0; i < numberOfChallans; i++) {
      const invoiceNo = await generateChallanNumber();
      const vehicleInfo = vehicleDetails?.[i] || {};
      const mobileNo = vehicleInfo.mobileNo
        ? String(vehicleInfo.mobileNo).trim()
        : null;

      const challanItems = [];

      const distribution = splitInfo?.itemsDistribution?.[i] || [];

      // ✅ PRODUCT-WISE DISTRIBUTION (FIXED)
      for (const item of distribution) {
        const orderProduct = order.products.find(
          (p) => p.product._id.toString() === item.productId
        );

        if (!orderProduct) continue;

        const savedRate = Number(orderProduct.price);
        const fallbackRate = Number(
          orderProduct.originalPrice || orderProduct.product?.originalPrice || 0
        );
        const rate = Number.isFinite(savedRate) ? savedRate : fallbackRate;

        challanItems.push({
          productId: orderProduct.product._id,
          description: orderProduct.product.name,
          category: orderProduct.product.category,
          boxes: item.boxes,
          rate,
          amount: item.boxes * rate,
          isExtraItem: false
        });
      }

      // ✅ EXTRA ITEMS
      if (extraItems?.length) {
        for (const extraItem of extraItems) {
          challanItems.push({
            description: extraItem.productName,
            category: extraItem.category || "Bottle",
            boxes: extraItem.quantity,
            rate: extraItem.rate,
            amount: extraItem.quantity * extraItem.rate,
            isExtraItem: true
          });
        }
      }

      const totalAmount = challanItems.reduce((s, i) => s + i.amount, 0);

      const challanDeliveryCharge = Array.isArray(requestedDeliveryCharge)
        ? Number(requestedDeliveryCharge[i] || 0)
        : requestedDeliveryCharge !== undefined && requestedDeliveryCharge !== null
          ? Number(requestedDeliveryCharge)
          : numberOfChallans === 1
            ? Number(order.deliveryCharge || 0)
            : 0;

      if (Number.isNaN(challanDeliveryCharge) || challanDeliveryCharge < 0) {
        return res.status(400).json({
          error: "Delivery charge must be a valid non-negative number",
        });
      }

      const challan = await Challan.create({
        userCode: order.user.customerDetails.userCode,
        invoiceNo,
        dcNo: invoiceNo,
        date: new Date(),
        scheduledDate: scheduledDates?.[i] || new Date(),
        originalOrder: orderId,
        items: challanItems,
        totalAmount,
        deliveryCharge: challanDeliveryCharge,
        totalAmountWithDelivery: roundAmount(totalAmount + challanDeliveryCharge),
        vehicleNo: vehicleInfo.vehicleNo,
        driverName: vehicleInfo.driverName,
        mobileNo: mobileNo || undefined,
        receiverName,
        shippingAddress: shippingAddress || order.shippingAddress,
        deliveryChoice: deliveryChoice || order.deliveryChoice,
        status: "scheduled"
      });

      const populatedChallan = await Challan.findById(challan._id)
        .populate("items.productId", "name category type")
        .lean();

      generatedChallans.push(populatedChallan);
    }

    // ✅ RESPONSE
    res.json({
      message: "Challans generated successfully",
      count: generatedChallans.length,
      challans: generatedChallans.map((challan) => ({
        ...challan,
        gst: Number((Number(challan.totalAmount || 0) * 0.05).toFixed(2)),
        totalAmountWithGST: roundAmount(
          Number(challan.totalAmount || 0) +
            Number((Number(challan.totalAmount || 0) * 0.05).toFixed(2))
        ),
        totalAmountWithDelivery: roundAmount(
          Number(challan.totalAmount || 0) +
          Number((Number(challan.totalAmount || 0) * 0.05).toFixed(2)) +
          Number(challan.deliveryCharge || 0)
        ),
        items: (challan.items || []).map((item) => ({
          ...item,
          productName:
            item.productId?.name || item.description || "Unknown",
          category: item.productId?.category || item.category || "Bottle",
        })),
      })),
    });

    // ✅ EMAIL (UNCHANGED)
    setImmediate(async () => {
      try {
        const userEmail = order.user.email;
        if (!userEmail) return;

        const subject = `Challan Details - Order ${orderId.slice(-6)}`;

        let challanTables = "";

        generatedChallans.forEach((c, index) => {
          const itemsRows = c.items.map(item => `
            <tr>
              <td>${item.description}</td>
              <td>${item.boxes}</td>
              <td>₹${item.rate}</td>
              <td>₹${item.amount}</td>
            </tr>
          `).join("");

          challanTables += `
            <h3>Challan ${index + 1}</h3>
            <table border="1" cellpadding="6" cellspacing="0" width="100%">
              <tr><th>Invoice No</th><td>${c.invoiceNo}</td></tr>
              <tr><th>Vehicle</th><td>${c.vehicleNo || "-"}</td></tr>
              <tr><th>Driver</th><td>${c.driverName || "-"}</td></tr>
            </table>
            <br/>
            <table border="1" cellpadding="6" cellspacing="0" width="100%">
              <tr>
                <th>Product</th>
                <th>Boxes</th>
                <th>Rate</th>
                <th>Amount</th>
              </tr>
              ${itemsRows}
            </table>
            <hr/>
          `;
        });

        const htmlMessage = `
          <div style="font-family: Arial;">
            <h2>Challan Generated</h2>
            ${challanTables}
          </div>
        `;

        await sendMail(subject, htmlMessage, true);
      } catch (err) {
        console.error("Email failed:", err.message);
      }
    });

  } catch (error) {
    console.error("Challan error:", error);
    res.status(500).json({
      error: "Error generating challan",
      details: error.message,
    });
  }
};
exports.getProductsForSelection = async (req, res) => {
  try {
    const { type, search } = req.query;

    let filter = { isActive: true };

    if (type) {
      filter.type = type;
    }

    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }

    const products = await Product.find(filter)
      .select('name type category originalPrice discountedPrice boxes bottlesPerBox')
      .sort({ name: 1 });

    const formattedProducts = products.map(product => {
      const productObj = product.toObject();

      // Calculate current price (considering discounts)
      const now = new Date();
      const isValidOffer =
        productObj.discountedPrice &&
        productObj.validFrom &&
        productObj.validTo &&
        now >= productObj.validFrom &&
        now <= productObj.validTo;

      const currentPrice = isValidOffer ? productObj.discountedPrice : productObj.originalPrice;

      return {
        _id: productObj._id,
        name: productObj.name,
        type: productObj.type,
        category: productObj.category,
        price: currentPrice,
        boxes: productObj.boxes,
        bottlesPerBox: productObj.bottlesPerBox,
        hasDiscount: isValidOffer,
        originalPrice: productObj.originalPrice,
        discountedPrice: isValidOffer ? productObj.discountedPrice : null
      };
    });

    res.json({
      success: true,
      products: formattedProducts
    });

  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({
      error: "Error fetching products",
      details: error.message,
    });
  }
};

// Get product by ID
exports.getProductById = async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const productObj = product.toObject();

    // Calculate current price
    const now = new Date();
    const isValidOffer =
      productObj.discountedPrice &&
      productObj.validFrom &&
      productObj.validTo &&
      now >= productObj.validFrom &&
      now <= productObj.validTo;

    const currentPrice = isValidOffer ? productObj.discountedPrice : productObj.originalPrice;

    const response = {
      _id: productObj._id,
      name: productObj.name,
      type: productObj.type,
      category: productObj.category,
      price: currentPrice,
      boxes: productObj.boxes,
      bottlesPerBox: productObj.bottlesPerBox,
      hasDiscount: isValidOffer,
      originalPrice: productObj.originalPrice,
      discountedPrice: isValidOffer ? productObj.discountedPrice : null
    };

    res.json({
      success: true,
      product: response
    });

  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({
      error: "Error fetching product",
      details: error.message,
    });
  }
};

// Function to reschedule challan date
exports.rescheduleChallan = async (req, res) => {
  try {
    const { challanId } = req.params;
    const { newDate, reason } = req.body;

    if (!newDate) {
      return res.status(400).json({ error: "New date is required" });
    }

    const challan = await Challan.findById(challanId);
    if (!challan) {
      return res.status(404).json({ error: "Challan not found" });
    }

    if (challan.status === "dispatched") {
      return res.status(400).json({ error: "Cannot reschedule dispatched challan" });
    }

    const oldDate = challan.scheduledDate;
    challan.scheduledDate = new Date(newDate);

    // Add to reschedule history
    challan.rescheduleHistory.push({
      oldDate: oldDate,
      newDate: new Date(newDate),
      reason: reason || "No reason provided",
      rescheduledBy: req.user._id
    });

    await challan.save();

    res.json({
      message: "Challan rescheduled successfully",
      challan: {
        _id: challan._id,
        dcNo: challan.dcNo,
        oldDate: oldDate,
        newDate: challan.scheduledDate,
        reason: reason
      }
    });

  } catch (error) {
    console.error("Reschedule error:", error);
    res.status(500).json({
      error: "Error rescheduling challan",
      details: error.message,
    });
  }
};

// Function to get challans by order (for split view)
exports.getChallansByOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const challans = await Challan.find({ originalOrder: orderId })
      .sort({ "splitInfo.splitIndex": 1 });

    res.json({
      count: challans.length,
      challans: challans
    });
  } catch (error) {
    console.error("Error fetching order challans:", error);
    res.status(500).json({
      error: "Error fetching order challans",
      details: error.message,
    });
  }
};


exports.getCurrentOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      orderStatus: { $in: ["pending", "processing"] }, // Corrected 'status' to 'orderStatus'
    })
      .populate(
        "user",
        "name customerDetails.firmName customerDetails.userCode"
      )
      .populate("products.product", "name type")
      .sort({ createdAt: -1 });

    const formattedOrders = orders.map((order) => ({
      ...order.toObject(),
      totalAmount: Number(order.totalAmount),
      deliveryCharge: Number(order.deliveryCharge || 0),
      totalAmountWithDelivery: Number(order.totalAmountWithDelivery),
      orderId: order.orderId, // Virtual field from Order model
    }));

    res.json({ orders: formattedOrders });
  } catch (error) {
    console.error("Error fetching current orders:", error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
};


exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    const validStatuses = ["confirmed", "shipped", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status for dispatch" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(400).json({ error: "Order not found" });
    }

    order._updatedBy = req.user._id;
    order.orderStatus = status;
    await order.save();

    if (status === "shipped" && order.paymentMethod === "COD") {
      order.paymentStatus = "pending";
    }

    await order.save();

    res.json({ message: "Order status updated successfully", order });
  } catch (error) {
    res.status(500).json({ error: "Error updating order status" });
  }
};

exports.getProcessingOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      orderStatus: { $in: ["approved_by_sales"] },
    })
      .populate(
        "user",
        "name phoneNumber email customerDetails.firmName customerDetails.userCode"
      )
      .populate("products.product")
      .sort({ createdAt: -1 });

    const formattedOrders = orders.map((order) => {
      const orderObj = order.toObject();

      // ✅ BASE VALUES
      const baseAmount = Number(order.totalAmount || 0);
      const deliveryCharge = Number(order.deliveryCharge || 0);

      // ✅ SUBTOTAL (INCLUDING DELIVERY)
      const subtotal = baseAmount + deliveryCharge;

      // ✅ GST (5%)
      const gst = Number((subtotal * 0.05).toFixed(2));

      // ✅ FINAL AMOUNT
      const totalAmountWithGST = roundAmount(subtotal + gst);

      return {
        ...orderObj,

        // ✅ ORIGINAL (cleaned)
        totalAmount: baseAmount,
        deliveryCharge,
        totalAmountWithDelivery: subtotal,

        // 🔥 NEW FIELDS
        amount: baseAmount,
        gst,
        totalAmountWithGST,
      };
    });

    res.json({ orders: formattedOrders });

  } catch (error) {
    console.error("Error fetching approved_by_sales orders:", error);
    res.status(500).json({ error: "Error fetching approved_by_sales orders" });
  }
};

exports.moveToSalesPending = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // ✅ Only allow change from approved_by_sales
    if (order.orderStatus !== "approved_by_sales") {
      return res.status(400).json({
        message: "Only approved_by_sales orders can be moved to sales_pending",
      });
    }

    // ✅ Update status
    order.orderStatus = "sales_pending";
    await order.save();

    res.json({
      success: true,
      message: "Order moved to sales_pending successfully",
      order,
    });

  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.downloadChallan = async (req, res) => {
  try {
    const { challanId } = req.params;

    const challan = await Challan.findById(challanId);
    if (!challan) {
      return res.status(404).json({ error: "Challan not found" });
    }

    const pdfBuffer = await generateChallanPDF(challan);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=challan-${challan.dcNo}.pdf`
    );

    res.send(pdfBuffer);
  } catch (error) {
    console.error("Error downloading challan:", error);
    res.status(500).json({
      error: "Error downloading challan",
      details: error.message,
    });
  }
};

exports.cancelChallan = async (req, res) => {
  try {
    const { challanId } = req.params;
    const { reason } = req.body;

    const challan = await Challan.findById(challanId);

    if (!challan) {
      return res.status(404).json({ message: "Challan not found" });
    }

    // ❌ Already cancelled
    if (challan.status === "cancelled") {
      return res.status(400).json({
        message: "Challan is already cancelled",
      });
    }

    // ❌ Prevent cancelling dispatched challan (optional rule)
    if (challan.status === "dispatched") {
      return res.status(400).json({
        message: "Dispatched challan cannot be cancelled",
      });
    }

    // ✅ Update status
    challan.status = "cancelled";

    // ✅ Optional: store cancellation history
    challan.rescheduleHistory.push({
      oldDate: challan.scheduledDate,
      newDate: challan.scheduledDate,
      reason: reason || "Cancelled by dispatch",
      rescheduledBy: req.user._id,
      rescheduledAt: new Date(),
    });

    await challan.save();

    res.json({
      success: true,
      message: "Challan cancelled successfully",
      challan,
    });

  } catch (error) {
    console.error("Error cancelling challan:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.generateStandaloneChallan = async (req, res) => {
  try {
    const {
      userCode,
      vehicleNo,
      driverName,
      mobileNo,
      items,
      receiverName,
      deliveryChoice,
      shippingAddress,
      deliveryCharge: manualDeliveryCharge,
      scheduledDate,
      orderId,
    } = req.body;

    if (!userCode) {
      return res.status(400).json({ error: "User code is required" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Invalid or empty items list" });
    }

    if (!scheduledDate) {
      return res.status(400).json({ error: "Scheduled date is required" });
    }

    const invoiceNo = await generateInvoiceNumber();

    let totalAmount = 0;

    // ✅ FETCH ORDER (NO NEED populate)
    let order = null;
    if (orderId) {
      order = await Order.findById(orderId).lean();
    }

    const formattedItems = await Promise.all(
      items.map(async (item) => {
        const boxes = Number(item.boxes) || 0;

        if (boxes < 230) {
          throw new Error(
            `Minimum 230 boxes required for item: ${
              item.productName || item.description
            }`
          );
        }

        let product = null;

        // ✅ Only for display
        if (item.productId) {
          product = await Product.findById(item.productId).select(
            "name category type"
          );
        }

        let rate = 0;

        // 🔥🔥🔥 MAIN FIX START 🔥🔥🔥
        if (order && item.productId) {
          const orderProduct = order.products.find(
            (p) =>
              String(p.product) === String(item.productId)
          );

          if (orderProduct) {
            const savedRate = Number(orderProduct.price);
            if (Number.isFinite(savedRate)) {
              rate = savedRate;
            }
          }
        }

        // ✅ fallback (manual items)
        if (!rate || rate === 0) {
          rate = Number(item.rate || 0);
        }
        // 🔥🔥🔥 MAIN FIX END 🔥🔥🔥

        const amount = boxes * rate;
        totalAmount += amount;

        return {
          description:
            product?.name ||
            item.productName ||
            item.description ||
            "Unnamed Item",

          productId: product?._id || undefined,

          boxes,
          rate,
          amount,

          category: product?.category,
          type: product?.type,

          isExtraItem: item.isExtraItem || false,
        };
      })
    );

    const deliveryCharge =
      manualDeliveryCharge !== undefined && manualDeliveryCharge !== null
        ? Number(manualDeliveryCharge)
        : Number(order?.deliveryCharge || 0);

    if (Number.isNaN(deliveryCharge) || deliveryCharge < 0) {
      return res.status(400).json({
        error: "Delivery charge must be a valid non-negative number",
      });
    }
    const totalAmountWithDelivery = totalAmount + deliveryCharge;

    const challan = new Challan({
      userCode,
      invoiceNo,
      date: new Date(),
      scheduledDate: new Date(scheduledDate),
      vehicleNo,
      driverName,
      mobileNo,
      items: formattedItems,
      totalAmount,
      deliveryCharge,
      totalAmountWithDelivery,
      receiverName,
      dcNo: invoiceNo,
      shippingAddress: shippingAddress || undefined,
      deliveryChoice: deliveryChoice || undefined,
      status: "scheduled",
      originalOrder: order?._id || undefined,
    });

    const savedChallan = await challan.save();

    const populatedChallan = await Challan.findById(savedChallan._id)
      .populate("items.productId", "name category type");

    res.json({
      message: "Challan generated successfully",
      challan: populatedChallan,
      downloadUrl: `/api/dispatch/challan/${savedChallan._id}/download`,
    });

  } catch (error) {
    console.error("Challan generation error:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        error: "Duplicate challan generated",
      });
    }

    res.status(500).json({
      error: "Error generating challan",
      details: error.message,
    });
  }
};

exports.getChallansByUserCode = async (req, res) => {
  try {
    const { userCode } = req.params;

    if (!userCode) {
      return res.status(400).json({ error: "User code is required" });
    }

    const challans = await Challan.find({ userCode })
      .populate({
        path: "originalOrder",
        select: "_id orderId firmName",
      })
      .populate("items.productId", "name category type")
      .sort({ createdAt: -1 })
      .lean();

    if (!challans.length) {
      return res.status(404).json({
        error: "No challans found for this user code",
      });
    }

    const formatted = challans.map((c) => {
      const baseAmount = Number(c.totalAmount || 0);
      const deliveryCharge = Number(c.deliveryCharge || 0);

      // ✅ GST only on base amount
      const gst = Number((baseAmount * 0.05).toFixed(2));

      // ✅ Subtotal = base + GST
      const subtotal = Number((baseAmount + gst).toFixed(2));

      // ✅ Total = subtotal + delivery charge
      const totalAmountWithGST = Number(
        (subtotal + deliveryCharge).toFixed(2)
      );

      return {
        challanId: c._id,
        invoiceNo: c.invoiceNo,
        dcNo: c.dcNo,

        orderCode: c.originalOrder?.orderId || null,
        firmName: c.originalOrder?.firmName || null,

        items: c.items.map((item) => ({
          productName: item.productId?.name || item.description,
          category: item.productId?.category || "Bottle",
          boxes: item.boxes,
          rate: Number(item.rate),
          amount: Number(item.amount),
        })),

        // ✅ Updated Calculations
        baseAmount,
        gst,
        subtotal,
        deliveryCharge,
        totalAmount: totalAmountWithGST,

        status: c.status,
        createdAt: c.createdAt,
      };
    });

    res.json({
      count: formatted.length,
      challans: formatted,
    });
  } catch (error) {
    console.error("Error fetching challans:", error);
    res.status(500).json({
      error: "Error fetching challans",
      details: error.message,
    });
  }
};

exports.getOrderHistory = async (req, res) => {
  try {
    const thirtyFiveDaysAgo = new Date();
    thirtyFiveDaysAgo.setDate(thirtyFiveDaysAgo.getDate() - 35);

    const orders = await Order.find({
      createdAt: { $gte: thirtyFiveDaysAgo },
    })
      .select(
        "orderId firmName gstNumber shippingAddress paymentStatus paymentMethod orderStatus createdAt type totalAmount products isMiscellaneous statusHistory"
      )
      .populate(
        "user",
        "name phoneNumber email role customerDetails.firmName customerDetails.userCode"
      )
      .populate("products.product", "name type category quantity")
      .populate("createdByReception", "name")
      .sort({ createdAt: -1 });

    const formattedOrders = await Promise.all(
      orders.map(async (order) => {
        const orderObj = order.toObject();

        // ✅ BASE AMOUNT
        const baseAmount = Number(order.totalAmount || 0);

        // ✅ GST (5%)
        const gst = Number((baseAmount * 0.05).toFixed(2));

        const totalAmountWithGST = roundAmount(baseAmount + gst);

        // ✅ FETCH CHALLANS
        let challans = [];
        try {
          challans = await Challan.find({
            originalOrder: order._id,
          }).lean();
        } catch (err) {
          console.error("Challan fetch error:", err.message);
        }

        // ✅ DELIVERY FROM CHALLANS
        const deliveryCharge = (challans || []).reduce(
          (sum, c) => sum + Number(c.deliveryCharge || 0),
          0
        );

        // ✅ FINAL TOTAL
        const totalAmountWithDelivery = roundAmount(
          totalAmountWithGST + deliveryCharge
        );

        if (!order.user) {
          console.warn(
            `Order ${order.orderId} has no associated user. Order ID: ${order._id}`
          );

          return {
            ...orderObj,

            totalAmount: baseAmount,
            deliveryCharge,
            totalAmountWithDelivery,

            amount: baseAmount,
            gst,
            totalAmountWithGST,

            orderId: order.orderId,
            orderSource: `Unknown user (Order ID: ${order.orderId})`,
          };
        }

        return {
          ...orderObj,

          totalAmount: baseAmount,
          deliveryCharge,
          totalAmountWithDelivery,

          amount: baseAmount,
          gst,
          totalAmountWithGST,

          orderId: order.orderId,

          orderSource: order.createdByReception
            ? order.user.role === "miscellaneous"
              ? `Created by ${order.createdByReception.name} for ${order.user.name} (Miscellaneous)`
              : `Created by ${order.createdByReception.name} for ${order.user.customerDetails?.firmName || order.user.name
              }`
            : `Direct order by ${order.user.customerDetails?.firmName || order.user.name
            }`,
        };
      })
    );

    res.json({ orders: formattedOrders });

  } catch (error) {
    console.error("Error fetching order history:", error);
    res.status(500).json({
      error: "Error fetching order history",
      details: error.message,
    });
  }
};

exports.checkIn = async (req, res) => {
  try {
    const { selectedDate } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "Please upload a check-in image" });
    }

    if (!selectedDate) {
      return res.status(400).json({ error: "Please select a date for check-in" });
    }

    const checkInDate = new Date(selectedDate);
    checkInDate.setHours(0, 0, 0, 0);

    const existingAttendance = await Attendance.findOne({
      user: req.user._id,
      panel: "dispatch",
      selectedDate: checkInDate,
      $or: [{ status: "checked-in" }, { status: "present" }],
    });

    if (existingAttendance) {
      return res.status(400).json({ error: "Already checked in for this date" });
    }

    // ✅ FIXED UPLOAD
    const cloudinaryResponse = await uploadToCloudinary(
      req.file,
      "check-in-photos"
    );

    const attendance = new Attendance({
      user: req.user._id,
      panel: "dispatch",
      checkInTime: new Date(),
      selectedDate: checkInDate,
      status: "present",
      checkInImage: cloudinaryResponse.secure_url,
    });

    await attendance.save();

    res.json({ message: "Check-in successful", attendance });
  } catch (error) {
    console.error("Check-in error:", error);
    res.status(500).json({ error: "Error during check-in", details: error.message });
  }
};

exports.checkOut = async (req, res) => {
  try {
    const { selectedDate } = req.body;

    if (!selectedDate) {
      return res.status(400).json({
        error: "Please select a date for check-out",
      });
    }

    const checkOutDate = new Date(selectedDate);
    checkOutDate.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      user: req.user._id,
      panel: "dispatch",
      selectedDate: checkOutDate,
      status: "present",
    });

    if (!attendance) {
      return res.status(400).json({
        error: "No active check-in found for selected date",
      });
    }

    attendance.checkOutTime = new Date();
    attendance.status = "checked-out";
    await attendance.save();

    res.json({
      message: "Check-out successful",
      attendance,
    });
  } catch (error) {
    res.status(500).json({
      error: "Error during check-out",
      details: error.message,
    });
  }
};

exports.getDailyDispatchOrders = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dispatchOrders = await Order.find({
      createdAt: { $gte: today },
      orderStatus: { $in: ["processing", "shipped"] },
    }).populate("user", "name customerDetails.firmName");

    res.json({
      dailyDispatchOrders: dispatchOrders,
    });
  } catch (error) {
    res.status(500).json({
      error: "Error fetching daily dispatch orders",
      details: error.message,
    });
  }
};

exports.updateCODPaymentStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { paymentStatus, notes } = req.body;

    const validCODStatuses = [
      "pending",
      "payment_received_by_driver",
      "cash_paid_offline",
    ];

    if (!validCODStatuses.includes(paymentStatus)) {
      return res.status(400).json({
        error: "Invalid payment status for COD order",
      });
    }

    const order = await Order.findById(orderId).populate(
      "user",
      "name customerDetails.userCode"
    );

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.paymentMethod !== "COD") {
      return res.status(400).json({
        error: "This action is only allowed for COD orders",
      });
    }

    if (req.user.role !== "dispatch") {
      return res.status(403).json({
        error: "Only dispatch personnel can update COD payment status",
      });
    }

    if (["completed", "failed"].includes(order.paymentStatus)) {
      return res.status(400).json({
        error: "Cannot modify payment status after completion or failure",
      });
    }

    order._updatedBy = req.user._id;
    order.paymentStatus = paymentStatus;

    order.paymentStatusHistory.push({
      status: paymentStatus,
      updatedBy: req.user._id,
      notes: notes || `Updated by ${req.user.name}`,
    });

    await order.save();

    res.json({
      message: "COD payment status updated successfully",
      order: {
        orderId: order._id,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        updatedBy: req.user.name,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("Error updating COD payment status:", error);
    res.status(500).json({
      error: "Error updating COD payment status",
      details: error.message,
    });
  }
};

exports.getPendingPayments = async (req, res) => {
  try {
    const pendingPayments = await Payment.find({ status: "pending" })
      .populate(
        "user",
        "name phoneNumber email customerDetails.firmName customerDetails.userCode"
      )
      .populate({
        path: "orderDetails",
        populate: {
          path: "products.product",
          select: "name type",
        },
      })
      .sort({ createdAt: -1 });

    const formattedPayments = pendingPayments.map((payment) => {
      if (!payment.orderDetails) {
        console.warn(`Payment ${payment._id} has no valid orderDetails`);
        return {
          paymentId: payment._id,
          orderId: "N/A",
          user: {
            name: payment.user?.name || "N/A",
            firmName: payment.user?.customerDetails?.firmName || "N/A",
            userCode: payment.user?.customerDetails?.userCode || "N/A",
            phoneNumber: payment.user?.phoneNumber || "N/A",
            email: payment.user?.email || "N/A",
          },
          products: [],
          totalAmount: Number(payment.amount) || 0,
          paidAmount: Number(payment.paidAmount) || 0,
          remainingAmount: Number(payment.remainingAmount) || 0,
          paymentHistory: payment.paymentHistory.map((entry) => ({
            ...entry.toObject(),
            submittedAmount: Number(entry.submittedAmount),
            verifiedAmount: Number(entry.verifiedAmount),
          })),
          deliveryCharge: 0,
          totalAmountWithDelivery: Number(payment.amount) || 0,
          paymentMethod: "N/A",
          paymentStatus: payment.status,
          orderStatus: "N/A",
          shippingAddress: {},
          firmName: payment.user?.customerDetails?.firmName || "N/A",
          gstNumber: "N/A",
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
        };
      }

      return {
        paymentId: payment._id,
        orderId: payment.orderDetails._id,
        user: {
          name: payment.user?.name || "N/A",
          firmName: payment.user?.customerDetails?.firmName || "N/A",
          userCode: payment.user?.customerDetails?.userCode || "N/A",
          phoneNumber: payment.user?.phoneNumber || "N/A",
          email: payment.user?.email || "N/A",
        },
        products: payment.orderDetails.products.map((p) => ({
          productName: p.product?.name || "N/A",
          productType: p.product?.type || "N/A",
          boxes: Number(p.boxes) || 0,
          price: Number(p.price) || 0,
        })),
        totalAmount: Number(payment.amount) || 0,
        paidAmount: Number(payment.paidAmount) || 0,
        remainingAmount: Number(payment.remainingAmount) || 0,
        paymentHistory: payment.paymentHistory.map((entry) => ({
          ...entry.toObject(),
          submittedAmount: Number(entry.submittedAmount),
          verifiedAmount: Number(entry.verifiedAmount),
        })),
        deliveryCharge: Number(payment.orderDetails.deliveryCharge || 0),
        totalAmountWithDelivery:
          Number(payment.orderDetails.totalAmountWithDelivery) || 0,
        paymentMethod: payment.orderDetails.paymentMethod,
        paymentStatus: payment.orderDetails.paymentStatus,
        orderStatus: payment.orderDetails.orderStatus,
        shippingAddress: payment.orderDetails.shippingAddress,
        firmName: payment.orderDetails.firmName,
        gstNumber: payment.orderDetails.gstNumber || "N/A",
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
      };
    });

    res.json({
      count: formattedPayments.length,
      pendingPayments: formattedPayments,
    });
  } catch (error) {
    console.error("Error fetching pending payments:", error);
    res.status(500).json({
      error: "Error fetching pending payments",
      details: error.message,
    });
  }
};

exports.editOrderByDispatch = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { products } = req.body;

    const order = await Order.findById(orderId).populate("products.product");

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (!["approved_by_sales"].includes(order.orderStatus)) {
      return res.status(400).json({
        error: "Only processing or confirmed orders can be edited",
      });
    }

    let newProducts = [];
    let totalAmount = 0;
    let priceUpdated = false;

    for (const item of products) {
      const product = await Product.findById(item.productId);

      if (!product) {
        return res.status(400).json({
          error: `Product not found: ${item.productId}`,
        });
      }

      const now = new Date();

      const isOfferValid =
        product.discountedPrice &&
        product.validFrom &&
        product.validTo &&
        now >= product.validFrom &&
        now <= product.validTo;

      // Default price logic
      let price = isOfferValid
        ? product.discountedPrice
        : product.originalPrice;

      const manualPrice =
        item.pricePerBox !== undefined && item.pricePerBox !== null
          ? item.pricePerBox
          : item.price;

      // If dispatch manually sends price / pricePerBox -> override
      if (manualPrice !== undefined && manualPrice !== null) {
        price = Number(manualPrice);
        priceUpdated = true;
      }

      const boxes = Number(item.boxes);
      price = Number(price);

      if (Number.isNaN(boxes) || boxes < 1) {
        return res.status(400).json({
          error: `Invalid boxes for product: ${item.productId}`,
        });
      }

      if (Number.isNaN(price) || price < 0) {
        return res.status(400).json({
          error: `Invalid price for product: ${item.productId}`,
        });
      }

      const amount = boxes * price;

      totalAmount += amount;

      newProducts.push({
        product: product._id,
        boxes,
        price: price,
        originalPrice: product.originalPrice,
      });
    }

    order.products = newProducts;
    order.priceUpdated = priceUpdated;
    order.totalAmount = totalAmount;
    order.totalAmountWithDelivery = totalAmount + (order.deliveryCharge || 0);

    order._updatedBy = req.user._id;

    await order.save();

    res.json({
      message: "Order updated by dispatch successfully",
      order,
    });
  } catch (error) {
    console.error("Dispatch order edit error:", error);
    res.status(500).json({
      error: "Error editing order",
      details: error.message,
    });
  }
};

exports.addDeliveryCharge = async (req, res) => {
  try {
    const { orderId, deliveryCharge, deliveryChargePerBox } = req.body;

    const requestedCharge =
      deliveryCharge !== undefined ? deliveryCharge : deliveryChargePerBox;

    if (!orderId || requestedCharge === undefined || requestedCharge < 0) {
      return res.status(400).json({
        error: "Invalid order ID or delivery charge",
      });
    }

    const numericCharge = Number(requestedCharge);

    if (isNaN(numericCharge)) {
      return res.status(400).json({
        error: "Delivery charge must be a valid number",
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const baseAmount = Number(order.totalAmount) || 0;

    order.deliveryCharge = numericCharge;
    order.totalAmountWithDelivery = baseAmount + numericCharge;
    order.deliveryChargeAddedBy = req.user._id;
    order.orderStatus = "processing";

    await order.save();

    res.json({
      message: "Delivery charge added successfully",
      deliveryCharge: numericCharge,
      order,
    });

  } catch (error) {
    console.error("Error adding delivery charge:", error);
    res.status(500).json({
      error: "Error adding delivery charge",
      details: error.message,
    });
  }
};



exports.getChallansByOrderId = async (req, res) => {
  try {
    const { orderId } = req.params;

    let order;

    // ✅ Handle both ObjectId & custom orderId
    if (mongoose.Types.ObjectId.isValid(orderId)) {
      order = await Order.findById(orderId)
        .populate("products.product", "name category type")
        .populate("user", "name phoneNumber customerDetails");
    } else {
      order = await Order.findOne({ orderId })
        .populate("products.product", "name category type")
        .populate("user", "name phoneNumber customerDetails");
    }

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const challans = await Challan.find({ originalOrder: order._id })
      .populate("items.productId", "name category type")
      .sort({ createdAt: -1 })
      .lean();

    if (!challans.length) {
      return res.status(404).json({
        error: "No challans found for this order",
      });
    }

    const formatted = challans.map((c) => {
      const baseAmount = Number(c.totalAmount || 0);
      const deliveryCharge = Number(c.deliveryCharge || 0);

      // ✅ GST only on baseAmount
      const gst = Number((baseAmount * 0.05).toFixed(2));

      // ✅ total with GST
      const totalAmountWithGST = roundAmount(baseAmount + gst);

      // ✅ final total
      const totalAmountWithDelivery = roundAmount(
        totalAmountWithGST + deliveryCharge
      );

      return {
        challanId: c._id,
        invoiceNo: c.invoiceNo,
        dcNo: c.dcNo,

        customerName: order.user?.name,
        phone: order.user?.phoneNumber,

        firmName:
          order.user?.customerDetails?.firmName || order.firmName,

        userCode: order.user?.customerDetails?.userCode,

        challanDate: c.date,
        scheduledDate: c.scheduledDate,

        vehicleNo: c.vehicleNo,
        driverName: c.driverName,
        mobileNo: c.mobileNo,

        items: c.items.map((item) => {
          const orderProduct = order.products.find(
            (p) =>
              p.product?._id?.toString() ===
              item.productId?._id?.toString()
          );

          return {
            productName:
              item.productId?.name ||
              orderProduct?.product?.name ||
              item.description ||
              "Unknown",

            category:
              item.productId?.category ||
              orderProduct?.product?.category ||
              "Bottle",

            boxes: item.boxes,
            rate: Number(item.rate),
            amount: Number(item.amount),
            isExtraItem: item.isExtraItem,
          };
        }),

        // ✅ CORRECT CALCULATIONS
        totalAmount: baseAmount,
        gst,
        totalAmountWithGST,
        deliveryCharge,
        totalAmountWithDelivery,

        deliveryChoice: c.deliveryChoice,
        shippingAddress: c.shippingAddress || order.shippingAddress,

        status: c.status,
        splitInfo: c.splitInfo,

        order: {
          orderId: order.orderId,
          orderStatus: order.orderStatus,
          paymentMethod: order.paymentMethod,
        },

        createdAt: c.createdAt,
      };
    });

    res.json({
      count: formatted.length,
      challans: formatted,
    });
  } catch (error) {
    console.error("Error fetching challans:", error);
    res.status(500).json({
      error: "Error fetching challans",
      details: error.message,
    });
  }
};

exports.getAllChallansForDispatch = async (req, res) => {
  try {
    const { startDate, endDate, status } = req.query;

    const filter = {};

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);

      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    if (status) {
      filter.status = Array.isArray(status) ? { $in: status } : status;
    }

    const challans = await Challan.find(filter)
      .populate({
        path: "originalOrder",
        select: "orderStatus paymentMethod totalAmountWithDelivery firmName",
      })
      .populate({
        path: "items.productId",
        select: "name category type",
      })
      .sort({ createdAt: -1 })
      .lean();

    const formatted = challans.map((c) => {
      // ✅ Base amount (actual total of items)
      const baseAmount = Number(c.totalAmount || 0);

      // ✅ GST = 5% of base
      const gst = Number((baseAmount * 0.05).toFixed(2));

      // ✅ Total with GST
      const totalAmountWithGST = roundAmount(baseAmount + gst);

      // ✅ Delivery
      const deliveryCharge = Number(c.deliveryCharge || 0);

      // ✅ Final total
      const totalAmountWithDelivery = roundAmount(
        totalAmountWithGST + deliveryCharge
      );

      return {
        challanId: c._id,
        invoiceNo: c.invoiceNo,
        dcNo: c.dcNo,

        userCode: c.userCode,
        receiverName: c.receiverName,

        challanDate: c.date,
        scheduledDate: c.scheduledDate,

        vehicleNo: c.vehicleNo,
        driverName: c.driverName,
        mobileNo: c.mobileNo,

        items: c.items.map((item) => ({
          productName: item.productId?.name || item.description,
          category: item.productId?.category || "Bottle",
          boxes: item.boxes,
          rate: Number(item.rate),
          amount: Number(item.amount),
          isExtraItem: item.isExtraItem,
        })),

        // ✅ CORRECT VALUES
        totalAmount: baseAmount,
        gst,
        totalAmountWithGST,
        deliveryCharge,
        totalAmountWithDelivery,

        deliveryChoice: c.deliveryChoice,
        shippingAddress: c.shippingAddress,

        status: c.status,
        splitInfo: c.splitInfo,

        order: {
          orderId: c.originalOrder?._id,
          orderStatus: c.originalOrder?.orderStatus,
          paymentMethod: c.originalOrder?.paymentMethod,
          orderAmount: c.originalOrder?.totalAmountWithDelivery,
          firmName: c.originalOrder?.firmName,
        },

        rescheduleHistory: c.rescheduleHistory,
        createdAt: c.createdAt,
      };
    });

    res.json({ count: formatted.length, challans: formatted });

  } catch (error) {
    console.error("Error fetching challans for dispatch:", error);
    res.status(500).json({ error: "Error fetching challans" });
  }
};

exports.downloadPendingPaymentsExcel = async (req, res) => {
  try {
    const pendingPayments = await Payment.find({ status: "pending" })
      .populate(
        "user",
        "name phoneNumber email customerDetails.firmName customerDetails.userCode"
      )
      .populate({
        path: "orderDetails",
        populate: {
          path: "products.product",
          select: "name type",
        },
      })
      .sort({ createdAt: -1 });

    const formattedPayments = pendingPayments.map((payment) => {
      if (!payment.orderDetails) {
        console.warn(`Payment ${payment._id} has no valid orderDetails`);
        return {
          paymentId: payment._id,
          orderId: "N/A",
          user: {
            name: payment.user?.name || "N/A",
            firmName: payment.user?.customerDetails?.firmName || "N/A",
            userCode: payment.user?.customerDetails?.userCode || "N/A",
            phoneNumber: payment.user?.phoneNumber || "N/A",
            email: payment.user?.email || "N/A",
          },
          products: [],
          totalAmount: Number(payment.amount) || 0,
          paidAmount: Number(payment.paidAmount) || 0,
          remainingAmount: Number(payment.remainingAmount) || 0,
          paymentHistory: payment.paymentHistory.map((entry) => ({
            ...entry.toObject(),
            submittedAmount: Number(entry.submittedAmount),
            verifiedAmount: Number(entry.verifiedAmount),
          })),
          deliveryCharge: 0,
          totalAmountWithDelivery: Number(payment.amount) || 0,
          paymentMethod: "N/A",
          paymentStatus: payment.status,
          orderStatus: "N/A",
          shippingAddress: {},
          firmName: payment.user?.customerDetails?.firmName || "N/A",
          gstNumber: "N/A",
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
        };
      }

      return {
        paymentId: payment._id,
        orderId: payment.orderDetails._id,
        user: {
          name: payment.user?.name || "N/A",
          firmName: payment.user?.customerDetails?.firmName || "N/A",
          userCode: payment.user?.customerDetails?.userCode || "N/A",
          phoneNumber: payment.user?.phoneNumber || "N/A",
          email: payment.user?.email || "N/A",
        },
        products: payment.orderDetails.products.map((p) => ({
          productName: p.product?.name || "N/A",
          productType: p.product?.type || "N/A",
          boxes: Number(p.boxes) || 0,
          price: Number(p.price) || 0,
        })),
        totalAmount: Number(payment.amount) || 0,
        paidAmount: Number(payment.paidAmount) || 0,
        remainingAmount: Number(payment.remainingAmount) || 0,
        paymentHistory: payment.paymentHistory.map((entry) => ({
          ...entry.toObject(),
          submittedAmount: Number(entry.submittedAmount),
          verifiedAmount: Number(entry.verifiedAmount),
        })),
        deliveryCharge: Number(payment.orderDetails.deliveryCharge || 0),
        totalAmountWithDelivery:
          Number(payment.orderDetails.totalAmountWithDelivery) || 0,
        paymentMethod: payment.orderDetails.paymentMethod,
        paymentStatus: payment.orderDetails.paymentStatus,
        orderStatus: payment.orderDetails.orderStatus,
        shippingAddress: payment.orderDetails.shippingAddress,
        firmName: payment.orderDetails.firmName,
        gstNumber: payment.orderDetails.gstNumber || "N/A",
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
      };
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Pending Payments");

    worksheet.columns = [
      { header: "Payment ID", key: "paymentId", width: 15 },
      { header: "Order ID", key: "orderId", width: 15 },
      { header: "Customer Name", key: "customerName", width: 20 },
      { header: "Firm Name", key: "firmName", width: 20 },
      { header: "User Code", key: "userCode", width: 15 },
      { header: "Phone Number", key: "phoneNumber", width: 15 },
      { header: "Email", key: "email", width: 25 },
      { header: "Products", key: "products", width: 30 },
      { header: "Total Amount", key: "totalAmount", width: 15 },
      { header: "Paid Amount", key: "paidAmount", width: 15 },
      { header: "Remaining Amount", key: "remainingAmount", width: 15 },
      { header: "Payment History", key: "paymentHistory", width: 50 },
      { header: "Delivery Charge", key: "deliveryCharge", width: 15 },
      {
        header: "Total with Delivery",
        key: "totalAmountWithDelivery",
        width: 20,
      },
      { header: "Payment Method", key: "paymentMethod", width: 15 },
      { header: "Payment Status", key: "paymentStatus", width: 15 },
      { header: "Order Status", key: "orderStatus", width: 15 },
      { header: "Shipping Address", key: "shippingAddress", width: 30 },
      { header: "GST Number", key: "gstNumber", width: 15 },
      { header: "Created At", key: "createdAt", width: 20 },
      { header: "Updated At", key: "updatedAt", width: 20 },
    ];

    formattedPayments.forEach((payment) => {
      worksheet.addRow({
        paymentId: payment.paymentId,
        orderId: payment.orderId,
        customerName: payment.user.name,
        firmName: payment.user.firmName,
        userCode: payment.user.userCode,
        phoneNumber: payment.user.phoneNumber,
        email: payment.user.email,
        products: payment.products
          .map((p) => `${p.productName} (${p.boxes})`)
          .join(", "),
        totalAmount: payment.totalAmount,
        paidAmount: payment.paidAmount,
        remainingAmount: payment.remainingAmount,
        paymentHistory: JSON.stringify(
          payment.paymentHistory.map((entry) => ({
            referenceId: entry.referenceId,
            submittedAmount: entry.submittedAmount,
            status: entry.status,
            verifiedAmount: entry.verifiedAmount,
            submissionDate: entry.submissionDate,
            verificationDate: entry.verificationDate,
          }))
        ),
        deliveryCharge: payment.deliveryCharge,
        totalAmountWithDelivery: payment.totalAmountWithDelivery,
        paymentMethod: payment.paymentMethod,
        paymentStatus: payment.paymentStatus,
        orderStatus: payment.orderStatus,
        shippingAddress: JSON.stringify(payment.shippingAddress),
        gstNumber: payment.gstNumber,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString(),
      });
    });

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "D3D3D3" },
    };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=pending_payments.xlsx"
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error generating Excel file:", error);
    res.status(500).json({
      error: "Error generating Excel file",
      details: error.message,
    });
  }
};
