const User = require("../models/User");
const Order = require("../models/Order");
const fs = require("fs").promises;
const Challan = require("../models/Challan");
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
const generateUserCode = require("../utils/generateUserCode");
const roundAmount = require("../utils/roundAmount");
const roundFigure = require("../utils/roundFigure");

const getMiscellaneousUser = async (email) => {
  const user = await User.findOne({
    email,
    role: "miscellaneous",
  });
  if (!user) {
    throw new Error("Miscellaneous user not found");
  }
  return user;
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

const receptionController = {



  createCustomer: async (req, res) => {
    try {
      const {
        name,
        email,
        phoneNumber,
        password,
        firmName,
        gstNumber,
        panNumber,
        address,
        city,
        state,
        pinCode,
      } = req.body;

      if (
        !name ||
        !firmName ||
        !phoneNumber ||
        !password ||
        !address ||
        !city ||
        !state ||
        !pinCode
      ) {
        if (req.file) {
          await fs.unlink(req.file.path);
        }
        return res.status(400).json({
          error: "Missing required fields",
          details: {
            name: !name,
            firmName: !firmName,
            phoneNumber: !phoneNumber,
            password: !password,
            address: !address,
          },
        });
      }

      // Check if user exists by phone number (since email is optional)
      let existingUser;
      if (email) {
        existingUser = await User.findOne({ email });
      } else {
        // If no email, check by phone number
        existingUser = await User.findOne({ phoneNumber });
      }

      if (existingUser) {
        if (req.file) {
          await fs.unlink(req.file.path);
        }
        return res.status(400).json({ error: "User already registered with this email or phone number" });
      }

      const userCode = await generateUserCode();

      let photoUrl = null;
      if (req.file) {
        photoUrl = `/uploads/profile-photos/${req.file.filename}`;
        try {
          await fs.access(
            path.join(
              __dirname,
              "..",
              "uploads/profile-photos",
              req.file.filename
            )
          );
        } catch (err) {
          console.error("File access error:", err);
          return res.status(500).json({ error: "File upload failed" });
        }
      }

      // Create user with email or dummy email
      const user = new User({
        name,
        email: email || `${phoneNumber}@customer.com`, // Use dummy email if not provided
        phoneNumber,
        password,
        role: "user",
        customerDetails: {
          firmName,
          gstNumber,
          panNumber,
          address: {
            address,
            city,
            state,
            pinCode,
          },
          photo: photoUrl,
          userCode,
        },
      });

      await user.save();

      const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });

      const userResponse = user.toObject();
      delete userResponse.password;

      res.status(201).json({
        message: "Customer registered successfully",
        user: userResponse,
        token,
        userCode: user.customerDetails.userCode,
      });
    } catch (error) {
      console.error("Registration error:", error);
      if (req.file) {
        await fs.unlink(req.file.path).catch(console.error);
      }
      res.status(500).json({
        error: "Error creating customer",
        details: error.message,
      });
    }
  },

  getAllUsers: async (req, res) => {
    try {
      const users = await User.find({ role: "user" })
        .select(
          "name email phoneNumber customerDetails.firmName customerDetails.userCode customerDetails.address isActive createdAt"
        )
        .sort({ createdAt: -1 });

      res.json({
        users: users.map((user) => ({
          userCode: user.customerDetails?.userCode,
          name: user.name,
          email: user.email,
          phoneNumber: user.phoneNumber,
          firmName: user.customerDetails?.firmName,

          // ✅ ADDRESS INCLUDED
          address: {
            address: user.customerDetails?.address?.address || "N/A",
            city: user.customerDetails?.address?.city || "N/A",
            state: user.customerDetails?.address?.state || "N/A",
            pinCode: user.customerDetails?.address?.pinCode || "N/A",
          },

          // 🔥 OPTIONAL: FULL ADDRESS STRING (useful for UI)
          fullAddress: user.customerDetails?.address
            ? `${user.customerDetails.address.address || ""}, ${user.customerDetails.address.city || ""}, ${user.customerDetails.address.state || ""} - ${user.customerDetails.address.pinCode || ""}`
            : "N/A",

          isActive: user.isActive,
          createdAt: user.createdAt,
        })),
      });
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ error: "Error fetching users" });
    }
  },

  getOrdersByUser: async (req, res) => {
    try {
      const { userCode } = req.params;

      const user = await User.findOne({ "customerDetails.userCode": userCode });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const orders = await Order.find({ user: user._id })
        .populate("products.product", "name price")
        .sort({ createdAt: -1 });

      res.json({ orders });
    } catch (error) {
      res.status(500).json({ error: "Error fetching user orders" });
    }
  },

  getUserPanelAccess: async (req, res) => {
    try {
      const { userCode } = req.body;

      if (!userCode) {
        return res.status(400).json({ error: "User code is required" });
      }

      const customerUser = await User.findOne({
        "customerDetails.userCode": userCode,
        role: "user",
        isActive: true,
      });

      if (!customerUser) {
        return res
          .status(404)
          .json({ error: "Customer not found or inactive" });
      }

      const token = jwt.sign(
        {
          userId: req.user._id,
          customerId: customerUser._id,
          isReceptionAccess: true,
        },
        process.env.JWT_SECRET,
        { expiresIn: "4h" }
      );

      res.json({
        success: true,
        token,
        customer: {
          name: customerUser.name,
          email: customerUser.email,
          firmName: customerUser.customerDetails.firmName,
          userCode: customerUser.customerDetails.userCode,
          address: customerUser.customerDetails.address,
        },
      });
    } catch (error) {
      console.error("Get user panel access error:", error);
      res.status(500).json({
        error: "Error generating user panel access",
        details: error.message,
      });
    }
  },

  getAllProductsForReception: async (req, res) => {
    try {
      // 🔐 Ensure only reception access
      if (!req.user || req.user.role !== "reception") {
        return res.status(403).json({
          error: "Only reception can access this API",
        });
      }

      const products = await Product.find({ isActive: true })
        .select(
          "name description type category originalPrice discountedPrice quantity image validFrom validTo"
        )
        .lean();

      const now = new Date();

      const formattedProducts = products.map((product) => {
        const isValidOffer =
          product.discountedPrice &&
          product.validFrom &&
          product.validTo &&
          now >= product.validFrom &&
          now <= product.validTo;

        return {
          _id: product._id,
          name: product.name,
          description: product.description,
          type: product.type,
          category: product.category,

          originalPrice: product.originalPrice,
          discountedPrice: isValidOffer ? product.discountedPrice : null,
          finalPrice: isValidOffer
            ? product.discountedPrice
            : product.originalPrice,

          quantity: product.quantity,
          image: product.image,

          offerActive: isValidOffer,
        };
      });

      res.json({
        count: formattedProducts.length,
        products: formattedProducts,
      });

    } catch (error) {
      console.error("Error fetching all products (reception):", error);
      res.status(500).json({
        error: "Error fetching products",
        details: error.message,
      });
    }
  },
  getFullOrdersByUser: async (req, res) => {
    try {
      const { userCode } = req.params;

      // 🔹 Find user first
      const user = await User.findOne({
        "customerDetails.userCode": userCode,
      }).select("name email phoneNumber customerDetails");

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // 🔹 Get Orders
      const orders = await Order.find({ user: user._id })
        .populate("products.product", "name image")
        .sort({ createdAt: -1 })
        .lean();

      // 🔹 Get Payment Details for all orders
      const orderIds = orders.map((o) => o._id);

      const payments = await Payment.find({
        orderDetails: { $in: orderIds },
      })
        .populate("user", "name email phoneNumber")
        .lean();

      // 🔥 Map payments to orders
      const paymentMap = {};
      payments.forEach((p) => {
        paymentMap[p.orderDetails.toString()] = p;
      });

      // 🔥 Final Response
      const formattedOrders = orders.map((order) => ({
        ...order,

        // attach payment
        paymentDetails: paymentMap[order._id.toString()] || null,
      }));

      res.json({
        user: {
          name: user.name,
          phone: user.phoneNumber,
          email: user.email,
          userCode: user.customerDetails?.userCode,
          firmName: user.customerDetails?.firmName,
        },
        totalOrders: formattedOrders.length,
        orders: formattedOrders,
      });
    } catch (error) {
      console.error("Error fetching full orders:", error);
      res.status(500).json({
        error: "Error fetching orders",
      });
    }
  },

  getUserProducts: async (req, res) => {
    try {
      if (!req.isReceptionAccess) {
        return res.status(403).json({ error: "Invalid access type" });
      }

      const products = await Product.find({ isActive: true })
        .select(
          "name description type category originalPrice discountedPrice quantity image validFrom validTo"
        )
        .lean();

      const formattedProducts = products.map((product) => {
        const isValidOffer =
          product.discountedPrice &&
          product.validFrom &&
          product.validTo &&
          new Date() >= product.validFrom &&
          new Date() <= product.validTo;

        return {
          _id: product._id,
          name: product.name,
          description: product.description,
          type: product.type,
          category: product.category,
          price: isValidOffer ? product.discountedPrice : product.originalPrice,
          quantity: product.quantity,
          image: product.image,
        };
      });

      res.json({
        products: formattedProducts,
        customerInfo: {
          name: req.customerUser.name,
          firmName: req.customerUser.customerDetails.firmName,
          userCode: req.customerUser.customerDetails.userCode,
        },
      });
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({
        error: "Error fetching products",
        details: error.message,
      });
    }
  },

  addPrice: async (req, res) => {
    try {
      if (!req.isReceptionAccess) {
        return res.status(403).json({ error: "Invalid Access Type" });
      }

      const { productId, price } = req.body;

      if (!productId || price == null || price < 0) {
        return res.status(400).json({
          status: false,
          message: "Product id and valid price are required"
        });
      }

      const product = await Product.findOneAndUpdate(
        { _id: productId, isActive: true },
        { $set: { originalPrice: price } },
        { new: true }
      );

      if (!product) {
        return res.status(404).json({
          status: false,
          message: "Product not found"
        });
      }

      return res.status(200).json({
        status: true,
        message: "Price updated successfully",
        data: product
      });

    } catch (error) {
      console.error("Error while adding the price", error);
      return res.status(500).json({
        status: false,
        message: "Internal Server Error"
      });
    }
  },

  createOrderAsReception: async (req, res) => {
    try {
      if (!req.isReceptionAccess) {
        return res.status(403).json({ error: "Invalid access type" });
      }

      const {
        products,
        paymentMethod,
        name,
        mobileNo,
        shippingAddress,
        deliveryChoice,
      } = req.body;

      if (!products?.length) {
        return res.status(400).json({ error: "Products are required" });
      }

      if (req.isMiscellaneous && (!name || !mobileNo)) {
        return res.status(400).json({
          error:
            "Name and mobile number are required for miscellaneous orders",
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
          error: "Complete shipping address with pin code is required",
        });
      }

      if (!/^\d{6}$/.test(shippingAddress.pinCode)) {
        return res.status(400).json({ error: "Pin code must be 6 digits" });
      }

      if (!["homeDelivery", "companyPickup"].includes(deliveryChoice)) {
        return res.status(400).json({ error: "Invalid delivery choice" });
      }

      const validPaymentMethods = ["UPI", "netBanking", "COD"];
      if (!validPaymentMethods.includes(paymentMethod)) {
        return res.status(400).json({
          error: "Invalid payment method",
          validMethods: validPaymentMethods,
        });
      }

      let totalAmount = 0;
      let totalBoxes = 0;
      const orderProducts = [];
      const productTypes = new Set();

      for (const item of products) {
        if (!item.productId || !item.boxes || item.price === undefined) {
          return res.status(400).json({
            error: `Invalid product data: ${JSON.stringify(item)}`,
          });
        }

        const boxes = Number(item.boxes);
        if (boxes < 1) {
          return res.status(400).json({
            error: `Minimum 1 box required for each product`,
          });
        }

        totalBoxes += boxes;
      }

      for (const item of products) {
        const product = await Product.findOne({
          _id: item.productId,
          isActive: true,
        });

        if (!product) {
          return res.status(404).json({
            error: `Product not found: ${item.productId}`,
          });
        }

        const boxes = Number(item.boxes);
        const price = Number(item.price);

        if (isNaN(price) || price < 0) {
          return res.status(400).json({
            error: `Invalid price for ${product.name}`,
          });
        }

        totalAmount += price * boxes;

        orderProducts.push({
          product: product._id,
          boxes,
          price,
          originalPrice: price,
        });

        productTypes.add(product.type);

        product.boxes = (product.boxes || 0) - boxes;
        product.stockRemarks.push({
          message: `Deducted ${boxes} boxes for order`,
          updatedBy: req.user._id,
          boxes: -boxes,
          changeType: "order",
        });

        await product.save();
      }

      const deliveryCharge = 0;

      const GST_PERCENTAGE = 5;
      const gstAmount = (totalAmount * GST_PERCENTAGE) / 100;

      const orderData = new Order({
        user: req.customerUser._id,
        products: orderProducts,
        totalAmount,
        gst: gstAmount,
        deliveryCharge,
        totalAmountWithDelivery: totalAmount + deliveryCharge + gstAmount,
        paymentMethod,
        paymentStatus: "pending",
        orderStatus: "sales_pending",
        createdByReception: req.user._id,
        type: [...productTypes][0],
        shippingAddress,
        deliveryChoice,
        firmName: req.customerUser.customerDetails.firmName,
        gstNumber: req.customerUser.customerDetails.gstNumber,
      });

      if (req.customerUser.role === "miscellaneous") {
        orderData.firmName = `${name} (Miscellaneous)`;
        orderData.shippingAddress = shippingAddress;
        orderData.isMiscellaneous = true;

        req.customerUser.phoneNumber = mobileNo;
        req.customerUser.name = name;
        req.customerUser.customerDetails.firmName = `${name} (Miscellaneous)`;

        await req.customerUser.save();
      }

      const order = new Order(orderData);
      await order.save();

      const payment = new Payment({
        user: req.customerUser._id,
        amount: totalAmount + deliveryCharge + gstAmount,
        status: "pending",
        userActivityStatus: req.customerUser.isActive ? "active" : "inactive",
        orderDetails: order._id,
      });

      await payment.save();

      // 🔹 Response
      res.status(201).json({
        message: "Order created successfully",
        order: {
          ...order.toObject(),
          gst: gstAmount,
          createdBy: {
            reception: req.user.name,
            customer:
              req.customerUser.role === "miscellaneous"
                ? `${name} (Miscellaneous)`
                : req.customerUser.customerDetails.firmName,
          },
        },
        paymentId: payment._id,
        amount: totalAmount + deliveryCharge + gstAmount,
        gst: gstAmount,
        totalBoxes,
        isMiscellaneous: req.isMiscellaneous || false,
      });
    } catch (error) {
      console.error("Error creating order:", error);
      res.status(500).json({
        error: "Error creating order",
        details: error.message,
      });
    }
  },

  getOrderHistory: async (req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        throw new Error("Database not connected");
      }

      const thirtyFiveDaysAgo = new Date();
      thirtyFiveDaysAgo.setDate(thirtyFiveDaysAgo.getDate() - 35);

      const orders = await Order.find({
        createdAt: { $gte: thirtyFiveDaysAgo },
      })
        .select(
          "orderId firmName gstNumber email shippingAddress paymentStatus paymentMethod orderStatus createdAt type totalAmount products isMiscellaneous statusHistory"
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

          const user = orderObj.user || {};
          const createdByReception = orderObj.createdByReception || {};
          const customerDetails = user.customerDetails || {};

          // ✅ FETCH PAYMENT
          const payment = await Payment.findOne({
            orderDetails: order._id,
          }).lean();

          // ✅ FETCH CHALLANS
          const challans = await Challan.find({
            originalOrder: order._id,
          }).lean();

          // ✅ SUM DELIVERY FROM CHALLANS
          const deliveryCharge = challans.reduce(
            (sum, c) => sum + Number(c.deliveryCharge || 0),
            0
          );

          // ✅ BASE AMOUNT
          const amount = Number(order.totalAmount || 0);

          // ✅ GST = 5%
          const gst = Number((amount * 0.05).toFixed(2));

          // ✅ TOTAL WITH GST
          const totalAmountWithGST = Number((amount + gst).toFixed(2));

          // ✅ FINAL TOTAL
        const totalAmountWithDelivery = roundAmount(
          totalAmountWithGST + deliveryCharge
        );

          return {
            ...orderObj,

            // ✅ SOURCE INFO
            orderSource: createdByReception.name
              ? user.role === "miscellaneous"
                ? `Created by ${createdByReception.name} for ${user.name || "Unknown"} (Miscellaneous)`
                : `Created by ${createdByReception.name} for ${customerDetails.firmName || user.name || "Unknown"
                }`
              : `Direct order by ${customerDetails.firmName || user.name || "Unknown"
              }`,

            // ✅ GST DETAILS
            amount,
            gst,
            totalAmountWithGST,

            // ✅ DELIVERY FROM CHALLAN
            deliveryCharge,
            totalAmountWithDelivery,

            // ✅ PAYMENT DETAILS
            paidAmount: payment?.paidAmount || 0,

            paymentDetails: payment
              ? {
                paymentId: payment._id,
                amount: payment.amount,
                paidAmount: payment.paidAmount,
                remainingAmount: payment.remainingAmount,
                status: payment.status,
              }
              : null,

            paymentHistory: payment?.paymentHistory || [],

            statusHistory: order.statusHistory || [],
          };
        })
      );

      res.json({ orders: formattedOrders });

    } catch (error) {
      console.error("Error in getOrderHistory:", error.message, error.stack);
      res.status(500).json({
        error: "Error fetching order history",
        details: error.message,
      });
    }
  },

  editOrder: async (req, res) => {
    try {
      const { orderId } = req.params;
      const { products, shippingAddress, deliveryChoice } = req.body;

      const order = await Order.findById(orderId).populate("products.product");

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // ❌ Don't allow editing after dispatch
      if (["confirmed", "shipped", "cancelled"].includes(order.orderStatus)) {
        return res.status(400).json({
          error: "Order cannot be edited at this stage",
        });
      }

      if (!products || !products.length) {
        return res.status(400).json({ error: "Products are required" });
      }

      let totalAmount = 0;
      let totalBoxes = 0;
      const updatedProducts = [];
      const productTypes = new Set();

      // 🔁 STEP 1: RESTORE OLD STOCK
      for (const item of order.products) {
        const product = await Product.findById(item.product);
        if (product) {
          product.boxes += item.boxes;

          product.stockRemarks.push({
            message: `Restored ${item.boxes} boxes (order edit)`,
            updatedBy: req.user._id,
            boxes: item.boxes,
            changeType: "edit_restore",
          });

          await product.save();
        }
      }

      // 🔥 STEP 2: APPLY NEW PRODUCTS (NO STOCK VALIDATION)
      for (const item of products) {
        if (!item.productId || !item.boxes || item.price === undefined) {
          return res.status(400).json({
            error: `Invalid product data`,
          });
        }

        const product = await Product.findById(item.productId);

        if (!product || !product.isActive) {
          return res.status(404).json({
            error: `Product not found: ${item.productId}`,
          });
        }

        const boxes = Number(item.boxes);
        const price = Number(item.price);

        if (boxes < 1) {
          return res.status(400).json({
            error: "Minimum 1 box required",
          });
        }

        // 🔥 ALLOW NEGATIVE STOCK
        product.boxes -= boxes;

        product.stockRemarks.push({
          message: `Deducted ${boxes} boxes (order edit)`,
          updatedBy: req.user._id,
          boxes: -boxes,
          changeType: "edit_deduct",
        });

        await product.save();

        totalBoxes += boxes;
        totalAmount += boxes * price;

        updatedProducts.push({
          product: product._id,
          boxes,
          price,
          originalPrice: price,
        });

        productTypes.add(product.type);
      }

      // 🔥 GST
      const GST_PERCENTAGE = 5;
      const gstAmount = (totalAmount * GST_PERCENTAGE) / 100;

      const deliveryCharge = order.deliveryCharge || 0;

      // 🔥 UPDATE ORDER
      order.products = updatedProducts;
      order.totalAmount = totalAmount;
      order.gst = gstAmount;
      order.totalAmountWithDelivery = totalAmount + deliveryCharge + gstAmount;
      order.type = [...productTypes][0];

      if (shippingAddress) {
        order.shippingAddress = shippingAddress;
      }

      if (deliveryChoice) {
        order.deliveryChoice = deliveryChoice;
      }

      await order.save();

      // 🔥 UPDATE PAYMENT
      const payment = await Payment.findOne({ orderDetails: order._id });

      if (payment) {
        payment.amount = order.totalAmountWithDelivery;
        await payment.save();
      }

      res.json({
        message: "Order updated successfully",
        order,
        totalBoxes,
        gst: gstAmount,
        amount: order.totalAmountWithDelivery,
      });

    } catch (error) {
      console.error("Error editing order:", error);
      res.status(500).json({
        error: "Error editing order",
        details: error.message,
      });
    }
  },

  searchUsers: async (req, res) => {
    try {
      const { query } = req.query;
      const users = await User.find({
        role: "user",
        $or: [
          { name: { $regex: query, $options: "i" } },
          { "customerDetails.firmName": { $regex: query, $options: "i" } },
          { "customerDetails.userCode": { $regex: query, $options: "i" } },
        ],
      }).select("-password");

      res.json({ users });
    } catch (error) {
      res.status(500).json({ error: "Error searching users" });
    }
  },

  getPendingOrders: async (req, res) => {
    try {
      const orders = await Order.find({
        orderStatus: "pending",
      })
        .populate(
          "user",
          "name email phoneNumber customerDetails.firmName customerDetails.userCode"
        )
        .populate(
          "products.product",
          "name price quantity category"
        )
        .sort({ createdAt: -1 });

      const formattedOrders = orders.map((order) => {
        const orderObj = order.toObject();

        // ✅ GST LOGIC (SAME AS getOrderHistory)
        const amount = Number(order.totalAmount || 0);
        const deliveryCharge = Number(order.deliveryCharge || 0);

        // subtotal (amount + delivery)
        const subtotal = amount + deliveryCharge;

        // GST 5%
        const gst = Number((subtotal * 0.05).toFixed(2));

        // final amount
        const totalAmountWithGST = Number((subtotal + gst).toFixed(2));

        return {
          ...orderObj,

          // ✅ CLEAN CUSTOMER DATA (optional but useful)
          customer: {
            name: order.user?.name,
            email: order.user?.email,
            phoneNumber: order.user?.phoneNumber,
            userCode: order.user?.customerDetails?.userCode,
            firmName: order.user?.customerDetails?.firmName,
          },

          // 🔥 GST FIELDS (IMPORTANT)
          amount,
          deliveryCharge,
          gst,
          totalAmountWithGST,

          // optional: keep original too
          totalAmountWithDelivery: subtotal,
        };
      });

      res.json({
        count: formattedOrders.length,
        orders: formattedOrders,
      });

    } catch (error) {
      console.error("Error fetching pending orders:", error);
      res.status(500).json({
        error: "Error fetching pending orders",
      });
    }
  },

  getPendingPaymentsDetails: async (req, res) => {
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

      const formattedPayments = await Promise.all(
        pendingPayments.map(async (payment) => {

          // Use the order subtotal as the base amount so GST is applied only once.
          const amount = Number(
            payment.orderDetails?.totalAmount ?? payment.amount ?? 0
          );

          const gst = Number((amount * 0.05).toFixed(2));
          const totalAmountWithGST = Number((amount + gst).toFixed(2));

          // ✅ FETCH CHALLANS
          let challans = [];
          try {
            if (payment.orderDetails?._id) {
              challans = await Challan.find({
                originalOrder: payment.orderDetails._id,
              }).lean();
            }
          } catch (err) {
            console.error("Challan fetch error:", err.message);
          }

          // ✅ SUM DELIVERY CHARGES FROM CHALLANS
          const deliveryCharge = (challans || []).reduce(
            (sum, c) => sum + Number(c.deliveryCharge || 0),
            0
          );

          // ✅ FINAL TOTAL
          const totalAmountWithDelivery = roundAmount(
            totalAmountWithGST + deliveryCharge
          );

          const paidAmount = Number(payment.paidAmount) || 0;
          const remainingAmount = Number(
            (totalAmountWithDelivery - paidAmount).toFixed(2)
          );

          const user = {
            name: payment.user?.name || "N/A",
            firmName: payment.user?.customerDetails?.firmName || "N/A",
            userCode: payment.user?.customerDetails?.userCode || "N/A",
            phoneNumber: payment.user?.phoneNumber || "N/A",
            email: payment.user?.email || "N/A",
          };

          const baseResponse = {
            paymentId: payment._id,
            orderId: payment.orderDetails?._id || "N/A",

            user,

            // ✅ CORRECT VALUES
            amount, // e.g. 21000
            gst, // e.g. 1050
            totalAmountWithGST, // e.g. 22050
            deliveryCharge, // from challan (750 + 600)
            totalAmountWithDelivery, // e.g. 23400

            paidAmount,
            remainingAmount,

            paymentPercentage:
              totalAmountWithDelivery > 0
                ? (
                  (paidAmount / totalAmountWithDelivery) *
                  100
                ).toFixed(2)
                : "0",

            paymentHistory: payment.paymentHistory.map((entry) => ({
              ...entry.toObject(),
              submittedAmount: Number(entry.submittedAmount),
              verifiedAmount: Number(entry.verifiedAmount),
            })),

            paymentMethod: payment.orderDetails?.paymentMethod || "N/A",
            paymentStatus: payment.orderDetails?.paymentStatus || payment.status,
            orderStatus: payment.orderDetails?.orderStatus || "N/A",

            shippingAddress: payment.orderDetails?.shippingAddress || {},
            firmName: payment.orderDetails?.firmName || user.firmName,
            gstNumber: payment.orderDetails?.gstNumber || "N/A",

            createdAt: payment.createdAt,
            updatedAt: payment.updatedAt,
          };

          // ✅ HANDLE PRODUCTS
          if (!payment.orderDetails) {
            return {
              ...baseResponse,
              products: [],
            };
          }

          return {
            ...baseResponse,
            products: payment.orderDetails.products.map((p) => ({
              productName: p.product?.name || "N/A",
              productType: p.product?.type || "N/A",
              boxes: Number(p.boxes) || 0,
              price: Number(p.price) || 0,
            })),
          };
        })
      );

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
  },

  getAllOrders: async (req, res) => {
    try {
      const orders = await Order.find()
        .populate({
          path: "user",
          select: "name email phoneNumber customerDetails",
        })
        .populate("products.product", "name type price")
        .sort({ createdAt: -1 });

      const ordersWithFullDetails = await Promise.all(
        orders.map(async (order) => {
          const payment = await Payment.findOne({
            orderDetails: order._id,
          });

          // ✅ CUSTOMER
          const customer = {
            name: order.user?.name,
            email: order.user?.email,
            phoneNumber: order.user?.phoneNumber,
            userCode: order.user?.customerDetails?.userCode,
            firmName: order.user?.customerDetails?.firmName,
            address: order.user?.customerDetails?.address,
            shippingAddress:
              order.user?.customerDetails?.shippingAddress ||
              order.shippingAddress ||
              "",
          };

          // ✅ PRODUCTS
          const products = order.products.map((item) => ({
            productId: item.product?._id,
            name: item.product?.name,
            type: item.product?.type,
            price: item.product?.price,
            boxes: item.boxes,
            total: item.price * item.boxes,
          }));

          // ✅ GST LOGIC (5%)
          const amount = Number(order.totalAmount || 0);
          const gst = Number((amount * 0.05).toFixed(2));
          const totalAmountWithGST = Number((amount + gst).toFixed(2));

          // ✅ PAYMENT
          let paymentDetails = null;

          if (payment) {
            const lastPayment =
              payment.paymentHistory.length > 0
                ? payment.paymentHistory[payment.paymentHistory.length - 1]
                : null;

            paymentDetails = {
              paymentId: payment._id,

              status: payment.status,
              totalAmount: payment.amount,
              paidAmount: payment.paidAmount,
              remainingAmount: payment.remainingAmount,

              lastPayment: lastPayment
                ? {
                  referenceId: lastPayment.referenceId,
                  paymentMode: lastPayment.paymentMode,
                  bankName: lastPayment.bankName,
                  screenshotUrl: lastPayment.screenshotUrl,
                  submittedAmount: lastPayment.submittedAmount,
                  status: lastPayment.status,
                  submissionDate: lastPayment.submissionDate,
                }
                : null,
            };
          }

          return {
            orderId: order._id,
            orderStatus: order.orderStatus,
            createdAt: order.createdAt,

            // ✅ ORIGINAL VALUES
            totalAmount: order.totalAmount,
            deliveryCharge: order.deliveryCharge,
            totalAmountWithDelivery: order.totalAmountWithDelivery,

            // 🔥 NEW GST VALUES
            amount, // base amount
            gst, // 5%
            totalAmountWithGST, // amount + gst

            customer,
            products,
            payment: paymentDetails,
          };
        })
      );

      res.json({ orders: ordersWithFullDetails });

    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ error: "Error fetching orders" });
    }
  },

  verifySubmittedPayment: async (req, res) => {
    try {
      const { paymentId } = req.params;
      const { verifiedAmount, notes } = req.body;

      const payment = await Payment.findById(paymentId);

      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }

      // ✅ Find submitted entry
      const paymentEntry = [...payment.paymentHistory]
        .reverse()
        .find((p) => p.status === "submitted");

      if (!paymentEntry) {
        return res.status(400).json({
          error: "No submitted payment found",
        });
      }

      // ✅ Update
      paymentEntry.status = "verified";
      paymentEntry.verifiedAmount =
        verifiedAmount || paymentEntry.submittedAmount;
      paymentEntry.verifiedBy = req.user._id;
      paymentEntry.verificationNotes = notes || "";
      paymentEntry.verificationDate = new Date();

      // ✅ Update main payment
      if (payment.paidAmount < payment.amount) {
        payment.status = "partial";
      } else {
        payment.status = "completed";
      }

      await payment.save();

      res.json({
        success: true,
        message: "Submitted payment verified successfully",
        payment,
      });

    } catch (error) {
      console.error("Error verifying submitted payment:", error);
      res.status(500).json({
        error: "Error verifying submitted payment",
      });
    }
  },

  updateOrderStatus: async (req, res) => {
    try {
      const { orderId } = req.params;
      const { status } = req.body;

      if (status !== "sales_pending") {
        return res.status(400).json({
          error: "Reception can only set orders to sales_pending",
        });
      }

      const order = await Order.findById(orderId).populate("products.product");
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      if (order.orderStatus !== "pending" && order.orderStatus !== "preview") {
        return res.status(400).json({
          error: "Can only process pending or preview orders",
        });
      }

      let totalAmount = 0;
      let priceChanged = false;
      const priceUpdateHistory = [];

      for (const item of order.products) {
        const product = await Product.findById(item.product._id);

        if (!product || !product.isActive) {
          return res.status(400).json({
            error: `Product ${item.product.name} is inactive or not found`,
          });
        }

        const now = new Date();

        const isOfferValid =
          product.discountedPrice != null &&
          product.validFrom &&
          product.validTo &&
          now >= new Date(product.validFrom) &&
          now <= new Date(product.validTo);

        const currentPrice = isOfferValid
          ? product.discountedPrice
          : product.originalPrice;

        if (currentPrice !== item.price) {
          priceChanged = true;

          priceUpdateHistory.push({
            product: item.product._id,
            oldPrice: item.price,
            newPrice: currentPrice,
            updatedBy: req.user._id,
          });

          item.price = currentPrice;
        }

        totalAmount += currentPrice * item.boxes;
      }

      if (priceChanged) {
        order.priceUpdated = true;
        order.priceUpdateHistory = priceUpdateHistory;
        order.totalAmount = totalAmount;
        order.totalAmountWithDelivery =
          totalAmount + (order.deliveryCharge || 0);

        const payment = await Payment.findOne({ orderDetails: order._id });

        if (payment) {
          payment.amount = order.totalAmountWithDelivery;
          await payment.save();
        }
      }

      // ======================================================
      // 🔥 NEW LOGIC: AUTO VERIFY PAYMENT
      // ======================================================

      const payment = await Payment.findOne({ orderDetails: order._id });

      if (payment && payment.paymentHistory.length > 0) {
        payment.paymentHistory = payment.paymentHistory.map((entry) => {
          if (entry.status === "submitted") {
            return {
              ...entry.toObject(),
              status: "verified",
              verifiedAmount: entry.submittedAmount,
              verifiedBy: req.user._id,
              verificationDate: new Date(),
            };
          }
          return entry;
        });

        // ✅ Update overall payment status
        if (payment.paidAmount === 0) {
          payment.status = "pending";
        } else if (payment.paidAmount < payment.amount) {
          payment.status = "partial";
        } else {
          payment.status = "completed";
        }

        await payment.save();
      }

      // ======================================================

      order._updatedBy = req.user._id;
      order.orderStatus = status;

      await order.save();

      res.json({
        message: "Order status updated & payment auto-verified",
        order,
        priceUpdated: priceChanged,
        priceUpdateDetails: priceChanged ? priceUpdateHistory : undefined,
      });

    } catch (error) {
      console.error("Error updating order status:", error);
      res.status(500).json({
        error: "Error updating order status",
        details: error.message,
      });
    }
  },

  checkIn: async (req, res) => {
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
        panel: "reception",
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
        panel: "reception", // ✅ FIXED
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
  },

  checkOut: async (req, res) => {
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
        panel: "reception",
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
  },

  getAttendance: async (req, res) => {
    try {
      const { startDate, endDate, panel, userId } = req.query;

      let query = {};

      if (startDate && endDate) {
        query.date = {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        };
      }

      if (panel) {
        query.panel = panel;
      }

      if (userId) {
        query.user = userId;
      }

      const attendance = await Attendance.find(query)
        .populate("user", "name email customerDetails.firmName")
        .sort({ date: -1 });

      const summary = {
        totalRecords: attendance.length,
        totalHours: attendance.reduce(
          (sum, record) => sum + (record.totalHours || 0),
          0
        ),
        averageHoursPerDay:
          attendance.reduce(
            (sum, record) => sum + (record.totalHours || 0),
            0
          ) / (attendance.length || 1),
      };

      res.json({
        attendance,
        summary,
      });
    } catch (error) {
      res.status(500).json({
        error: "Error fetching attendance",
        details: error.message,
      });
    }
  },

  addDeliveryCharge: async (req, res) => {
    try {
      const { orderId, deliveryChargePerBox } = req.body;

      if (!orderId || deliveryChargePerBox === undefined || deliveryChargePerBox < 0) {
        return res.status(400).json({
          error: "Invalid order ID or delivery charge per box",
        });
      }

      const numericCharge = Number(deliveryChargePerBox);

      if (isNaN(numericCharge)) {
        return res.status(400).json({
          error: "Delivery charge per box must be a valid number",
        });
      }

      const order = await Order.findById(orderId);

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Calculate total boxes
      const totalBoxes = order.products.reduce(
        (sum, item) => sum + Number(item.boxes),
        0
      );

      const deliveryCharge = totalBoxes * numericCharge;

      const baseAmount = Number(order.totalAmount) || 0;

      order.deliveryCharge = deliveryCharge;
      order.deliveryChargePerBox = numericCharge; // optional but recommended
      order.totalAmountWithDelivery = baseAmount + deliveryCharge;
      order.deliveryChargeAddedBy = req.user._id;
      order.orderStatus = "processing";

      await order.save();

      res.json({
        message: "Delivery charge added successfully",
        deliveryChargePerBox: numericCharge,
        totalBoxes,
        deliveryCharge,
        order,
      });

    } catch (error) {
      console.error("Error adding delivery charge:", error);
      res.status(500).json({
        error: "Error adding delivery charge",
        details: error.message,
      });
    }
  },

  getMiscellaneousPanelAccess: async (req, res) => {
    try {
      const { name, email, mobileNo } = req.body;

      if (!name || !mobileNo) {
        return res.status(400).json({
          error: "Name and mobile number are required",
        });
      }

      if (!/^\d{10}$/.test(mobileNo)) {
        return res.status(400).json({
          error: "Invalid mobile number. Must be 10 digits.",
        });
      }

      // ✅ DEFAULT ADDRESS OBJECT (FIX)
      const miscellaneousAddress = {
        address: "Walk-in Customer",
        city: "N/A",
        state: "N/A",
        pinCode: "000000",
      };

      // ✅ UNIQUE IDENTIFIER
      let uniqueIdentifier;
      if (email) {
        uniqueIdentifier = { email, role: "miscellaneous" };
      } else {
        uniqueIdentifier = { phoneNumber: mobileNo, role: "miscellaneous" };
      }

      let miscUser = await User.findOne(uniqueIdentifier);

      if (!miscUser) {
        const userCode = await generateUserCode();

        miscUser = new User({
          name,
          email: email || `${mobileNo}@miscellaneous.com`,
          phoneNumber: mobileNo,
          role: "miscellaneous",
          password: Math.random().toString(36).slice(-8),
          isActive: true,
          customerDetails: {
            firmName: `${name} (Miscellaneous)`,
            userCode,
            address: miscellaneousAddress, // ✅ FIXED
          },
        });

        await miscUser.save();
      } else {
        // ✅ UPDATE EXISTING USER
        miscUser.name = name;
        miscUser.phoneNumber = mobileNo;

        if (email) {
          miscUser.email = email;
        }

        miscUser.customerDetails = miscUser.customerDetails || {};
        miscUser.customerDetails.firmName = `${name} (Miscellaneous)`;

        // ✅ FIX: ENSURE OBJECT
        miscUser.customerDetails.address = miscellaneousAddress;

        await miscUser.save();
      }

      // ✅ TOKEN
      const token = jwt.sign(
        {
          userId: req.user._id,
          customerId: miscUser._id,
          isReceptionAccess: true,
          isMiscellaneous: true,
        },
        process.env.JWT_SECRET,
        { expiresIn: "4h" }
      );

      res.json({
        success: true,
        token,
        customer: {
          name,
          email: miscUser.email,
          mobileNo,
          firmName: `${name} (Miscellaneous)`,
          userCode: miscUser.customerDetails?.userCode,
        },
      });

    } catch (error) {
      console.error("Get miscellaneous panel access error:", error);
      res.status(500).json({
        error: "Error generating miscellaneous panel access",
        details: error.message,
      });
    }
  },

  getSubmittedPayments: async (req, res) => {
    try {
      const payments = await Payment.find({ status: "submitted" })
        .populate(
          "user",
          "name email phoneNumber customerDetails.firmName customerDetails.userCode"
        )
        .populate(
          "orderDetails",
          "totalAmountWithDelivery paymentMethod shippingAddress"
        )
        .sort({ createdAt: -1 });

      const formattedPayments = payments.map((payment) => ({
        ...payment.toObject(),
        amount: Number(payment.amount),
        paidAmount: Number(payment.paidAmount),
        remainingAmount: Number(payment.remainingAmount),
        paymentHistory: payment.paymentHistory.map((entry) => ({
          ...entry.toObject(),
          submittedAmount: Number(entry.submittedAmount),
          verifiedAmount: Number(entry.verifiedAmount),
        })),
        orderDetails: {
          ...payment.orderDetails.toObject(),
          totalAmountWithDelivery: Number(
            payment.orderDetails.totalAmountWithDelivery
          ),
        },
      }));

      res.json({ payments: formattedPayments });
    } catch (error) {
      console.error("Error fetching submitted payments:", error);
      res.status(500).json({
        error: "Error fetching submitted payments",
        details: error.message,
      });
    }
  },




  // getPendingPayments : async (req, res) => {
  //   try {
  //     const pendingPayments = await Payment.find({ status: "pending" })
  //       .populate(
  //         "user",
  //         "name phoneNumber email customerDetails.firmName customerDetails.userCode"
  //       )
  //       .populate({
  //         path: "orderDetails",
  //         populate: {
  //           path: "products.product",
  //           select: "name type",
  //         },
  //       })
  //       .sort({ createdAt: -1 });

  //     const formattedPayments = pendingPayments.map((payment) => {
  //       if (!payment.orderDetails) {
  //         console.warn(`Payment ${payment._id} has no valid orderDetails`);
  //         return {
  //           paymentId: payment._id,
  //           orderId: "N/A",
  //           user: {
  //             name: payment.user?.name || "N/A",
  //             firmName: payment.user?.customerDetails?.firmName || "N/A",
  //             userCode: payment.user?.customerDetails?.userCode || "N/A",
  //             phoneNumber: payment.user?.phoneNumber || "N/A",
  //             email: payment.user?.email || "N/A",
  //           },
  //           products: [],
  //           totalAmount: Number(payment.amount) || 0,
  //           paidAmount: Number(payment.paidAmount) || 0,
  //           remainingAmount: Number(payment.remainingAmount) || 0,
  //           paymentHistory: payment.paymentHistory.map((entry) => ({
  //             ...entry.toObject(),
  //             submittedAmount: Number(entry.submittedAmount),
  //             verifiedAmount: Number(entry.verifiedAmount),
  //           })),
  //           deliveryCharge: 0,
  //           totalAmountWithDelivery: Number(payment.amount) || 0,
  //           paymentMethod: "N/A",
  //           paymentStatus: payment.status,
  //           orderStatus: "N/A",
  //           shippingAddress: {},
  //           firmName: payment.user?.customerDetails?.firmName || "N/A",
  //           gstNumber: "N/A",
  //           createdAt: payment.createdAt,
  //           updatedAt: payment.updatedAt,
  //         };
  //       }

  //       return {
  //         paymentId: payment._id,
  //         orderId: payment.orderDetails._id,
  //         user: {
  //           name: payment.user?.name || "N/A",
  //           firmName: payment.user?.customerDetails?.firmName || "N/A",
  //           userCode: payment.user?.customerDetails?.userCode || "N/A",
  //           phoneNumber: payment.user?.phoneNumber || "N/A",
  //           email: payment.user?.email || "N/A",
  //         },
  //         products: payment.orderDetails.products.map((p) => ({
  //           productName: p.product?.name || "N/A",
  //           productType: p.product?.type || "N/A",
  //           boxes: Number(p.boxes) || 0,
  //           price: Number(p.price) || 0,
  //         })),
  //         totalAmount: Number(payment.amount) || 0,
  //         paidAmount: Number(payment.paidAmount) || 0,
  //         remainingAmount: Number(payment.remainingAmount) || 0,
  //         paymentHistory: payment.paymentHistory.map((entry) => ({
  //           ...entry.toObject(),
  //           submittedAmount: Number(entry.submittedAmount),
  //           verifiedAmount: Number(entry.verifiedAmount),
  //         })),
  //         deliveryCharge: Number(payment.orderDetails.deliveryCharge || 0),
  //         totalAmountWithDelivery:
  //           Number(payment.orderDetails.totalAmountWithDelivery) || 0,
  //         paymentMethod: payment.orderDetails.paymentMethod,
  //         paymentStatus: payment.orderDetails.paymentStatus,
  //         orderStatus: payment.orderDetails.orderStatus,
  //         shippingAddress: payment.orderDetails.shippingAddress,
  //         firmName: payment.orderDetails.firmName,
  //         gstNumber: payment.orderDetails.gstNumber || "N/A",
  //         createdAt: payment.createdAt,
  //         updatedAt: payment.updatedAt,
  //       };
  //     });

  //     res.json({
  //       count: formattedPayments.length,
  //       pendingPayments: formattedPayments,
  //     });
  //   } catch (error) {
  //     console.error("Error fetching pending payments:", error);
  //     res.status(500).json({
  //       error: "Error fetching pending payments",
  //       details: error.message,
  //     });
  //   }
  // },



  // getPendingPayments: async (req, res) => {
  //   try {
  //     const pendingPayments = await Payment.find({ status: "pending" })
  //       .populate(
  //         "user",
  //         "name phoneNumber email customerDetails.firmName customerDetails.userCode"
  //       )
  //       .populate({
  //         path: "orderDetails",
  //         populate: {
  //           path: "products.product",
  //           select: "name type",
  //         },
  //       })
  //       .sort({ createdAt: -1 });

  //     const formattedPayments = pendingPayments.map((payment) => {
  //       if (!payment.orderDetails) {
  //         console.warn(`Payment ${payment._id} has no valid orderDetails`);
  //         return {
  //           paymentId: payment._id,
  //           orderId: "N/A",
  //           user: {
  //             name: payment.user?.name || "N/A",
  //             firmName: payment.user?.customerDetails?.firmName || "N/A",
  //             userCode: payment.user?.customerDetails?.userCode || "N/A",
  //             phoneNumber: payment.user?.phoneNumber || "N/A",
  //             email: payment.user?.email || "N/A",
  //           },
  //           products: [],
  //           totalAmount: Number(payment.amount) || 0,
  //           paidAmount: Number(payment.paidAmount) || 0,
  //           remainingAmount: Number(payment.amount) - Number(payment.paidAmount) || 0,
  //           paymentHistory: payment.paymentHistory.map((entry) => ({
  //             ...entry.toObject(),
  //             submittedAmount: Number(entry.submittedAmount),
  //             verifiedAmount: Number(entry.verifiedAmount),
  //           })),
  //           deliveryCharge: 0,
  //           totalAmountWithDelivery: Number(payment.amount) || 0,
  //           paymentMethod: "N/A",
  //           paymentStatus: payment.status,
  //           orderStatus: "N/A",
  //           shippingAddress: {},
  //           firmName: payment.user?.customerDetails?.firmName || "N/A",
  //           gstNumber: "N/A",
  //           createdAt: payment.createdAt,
  //           updatedAt: payment.updatedAt,
  //         };
  //       }

  //       // Calculate remaining amount based on order's totalAmountWithDelivery
  //       const totalAmountWithDelivery = Number(payment.orderDetails.totalAmountWithDelivery) || 0;
  //       const paidAmount = Number(payment.paidAmount) || 0;
  //       const remainingAmount = totalAmountWithDelivery - paidAmount;

  //       return {
  //         paymentId: payment._id,
  //         orderId: payment.orderDetails._id,
  //         user: {
  //           name: payment.user?.name || "N/A",
  //           firmName: payment.user?.customerDetails?.firmName || "N/A",
  //           userCode: payment.user?.customerDetails?.userCode || "N/A",
  //           phoneNumber: payment.user?.phoneNumber || "N/A",
  //           email: payment.user?.email || "N/A",
  //         },
  //         products: payment.orderDetails.products.map((p) => ({
  //           productName: p.product?.name || "N/A",
  //           productType: p.product?.type || "N/A",
  //           boxes: Number(p.boxes) || 0,
  //           price: Number(p.price) || 0,
  //         })),
  //         totalAmount: Number(payment.orderDetails.totalAmount) || 0,
  //         paidAmount: paidAmount,
  //         remainingAmount: remainingAmount, // Now includes delivery charges
  //         paymentHistory: payment.paymentHistory.map((entry) => ({
  //           ...entry.toObject(),
  //           submittedAmount: Number(entry.submittedAmount),
  //           verifiedAmount: Number(entry.verifiedAmount),
  //         })),
  //         deliveryCharge: Number(payment.orderDetails.deliveryCharge || 0),
  //         totalAmountWithDelivery: totalAmountWithDelivery,
  //         paymentMethod: payment.orderDetails.paymentMethod,
  //         paymentStatus: payment.orderDetails.paymentStatus,
  //         orderStatus: payment.orderDetails.orderStatus,
  //         shippingAddress: payment.orderDetails.shippingAddress,
  //         firmName: payment.orderDetails.firmName,
  //         gstNumber: payment.orderDetails.gstNumber || "N/A",
  //         createdAt: payment.createdAt,
  //         updatedAt: payment.updatedAt,
  //       };
  //     });

  //     res.json({
  //       count: formattedPayments.length,
  //       pendingPayments: formattedPayments,
  //     });
  //   } catch (error) {
  //     console.error("Error fetching pending payments:", error);
  //     res.status(500).json({
  //       error: "Error fetching pending payments",
  //       details: error.message,
  //     });
  //   }
  // },


  getPendingPayments: async (req, res) => {
    try {
      const pendingPayments = await Payment.find({
        status: { $in: ["pending", "partial"] } // Include both pending and partial
      })
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
          const totalAmount = Number(payment.amount) || 0;
          const paidAmount = Number(payment.paidAmount) || 0;
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
            totalAmount: totalAmount,
            paidAmount: paidAmount,
            remainingAmount: totalAmount - paidAmount,
            paymentHistory: payment.paymentHistory.map((entry) => ({
              ...entry.toObject(),
              submittedAmount: Number(entry.submittedAmount),
              verifiedAmount: Number(entry.verifiedAmount),
            })),
            deliveryCharge: 0,
            totalAmountWithDelivery: totalAmount,
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

        // Calculate remaining amount based on order's totalAmountWithDelivery
        const totalAmountWithDelivery = Number(payment.orderDetails.totalAmountWithDelivery) || 0;
        const paidAmount = Number(payment.paidAmount) || 0;
        const remainingAmount = totalAmountWithDelivery - paidAmount;

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
          totalAmount: Number(payment.orderDetails.totalAmount) || 0,
          paidAmount: paidAmount,
          remainingAmount: remainingAmount,
          paymentHistory: payment.paymentHistory.map((entry) => ({
            ...entry.toObject(),
            submittedAmount: Number(entry.submittedAmount),
            verifiedAmount: Number(entry.verifiedAmount),
          })),
          deliveryCharge: Number(payment.orderDetails.deliveryCharge || 0),
          totalAmountWithDelivery: totalAmountWithDelivery,
          paymentMethod: payment.orderDetails.paymentMethod,
          paymentStatus: payment.status,
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
  },

  updatePaymentStatus: async (req, res) => {
    try {
      const { paymentId } = req.params;
      const { paymentStatus, receivedAmount, remarks, paymentMode, bankName, referenceId } = req.body;

      if (!paymentStatus || receivedAmount === undefined) {
        return res.status(400).json({
          error: "Payment status and received amount are required",
        });
      }

      const numericReceivedAmount = Number(receivedAmount);
      if (isNaN(numericReceivedAmount) || numericReceivedAmount < 0) {
        return res.status(400).json({
          error: "Received amount must be a valid positive number",
        });
      }

      const payment = await Payment.findById(paymentId)
        .populate("user")
        .populate("orderDetails");

      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }

      const validModes = ["cash", "online", "cheque"];
      if (!validModes.includes(paymentMode)) {
        return res.status(400).json({
          error: "Invalid payment mode",
        });
      }

      const validBanks = ["IDFC", "HDFC"];
      if (paymentMode === "online") {
        if (!bankName || !validBanks.includes(bankName)) {
          return res.status(400).json({
            error: "Valid bank required",
          });
        }
      }

      // ✅ HANDLE FILE UPLOAD
      let screenshotUrl = null;
      if (req.file) {
        screenshotUrl = `/uploads/payments/${req.file.filename}`;
      }

      let totalAmountDue = Number(payment.amount || 0);

      if (payment.orderDetails) {
        const amount = Number(payment.orderDetails.totalAmount || 0);
        const gst = Number((amount * 0.05).toFixed(2));

        const challans = await Challan.find({
          originalOrder: payment.orderDetails._id,
        }).lean();

        const deliveryCharge = challans.reduce(
          (sum, challan) => sum + Number(challan.deliveryCharge || 0),
          0
        );

        totalAmountDue = roundAmount(amount + gst + deliveryCharge);
      }

      const newPaidAmount = (payment.paidAmount || 0) + numericReceivedAmount;

      if (newPaidAmount > totalAmountDue) {
        return res.status(400).json({
          error: "Payment exceeds total",
        });
      }

      payment.paidAmount = newPaidAmount;

      let derivedPaymentStatus = "completed";
      if (newPaidAmount === 0) derivedPaymentStatus = "pending";
      else if (newPaidAmount < totalAmountDue) derivedPaymentStatus = "partial";

      payment.status = derivedPaymentStatus;

      if (payment.orderDetails) {
        payment.orderDetails.paymentStatus = derivedPaymentStatus;

        await payment.orderDetails.save();
      }

      payment.paymentHistory.push({
        referenceId: referenceId || null,
        paymentMode,
        bankName: paymentMode === "online" ? bankName : null,
        screenshotUrl: screenshotUrl || null,
        submittedAmount: numericReceivedAmount,
        status: "verified",
        verifiedAmount: numericReceivedAmount,
        verifiedBy: req.user._id,
        verificationNotes: remarks || "",
        submissionDate: new Date(),
        verificationDate: new Date(),
      });

      await payment.save();

      res.json({
        message: "Payment updated",
        payment,
      });

    } catch (error) {
      res.status(500).json({
        error: error.message,
      });
    }
  },

  getPartialPayments: async (req, res) => {
    try {
      const partialPayments = await Payment.find({ status: "partial" })
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

      const formattedPayments = await Promise.all(
        partialPayments.map(async (payment) => {

          const amount = Number(
            payment.orderDetails?.totalAmount ?? payment.amount ?? 0
          );
          const gst = Number((amount * 0.05).toFixed(2));
          const totalAmountWithGST = Number((amount + gst).toFixed(2));

          // ✅ FETCH CHALLANS
          let challans = [];
          try {
            if (payment.orderDetails?._id) {
              challans = await Challan.find({
                originalOrder: payment.orderDetails._id,
              }).lean();
            }
          } catch (err) {
            console.error("Challan fetch error:", err.message);
          }

          // ✅ DELIVERY FROM CHALLANS
          const deliveryCharge = (challans || []).reduce(
            (sum, c) => sum + Number(c.deliveryCharge || 0),
            0
          ); // e.g. 750 + 600 = 1350

          // ✅ FINAL TOTAL
          const totalAmountWithDelivery = roundAmount(
            totalAmountWithGST + deliveryCharge
          );

          const paidAmount = Number(payment.paidAmount) || 0;
          const remainingAmount = Number(
            (totalAmountWithDelivery - paidAmount).toFixed(2)
          );

          return {
            paymentId: payment._id,
            orderId: payment.orderDetails?._id || "N/A",

            user: {
              name: payment.user?.name || "N/A",
              firmName: payment.user?.customerDetails?.firmName || "N/A",
              userCode: payment.user?.customerDetails?.userCode || "N/A",
              phoneNumber: payment.user?.phoneNumber || "N/A",
              email: payment.user?.email || "N/A",
            },

            products:
              payment.orderDetails?.products.map((p) => ({
                productName: p.product?.name || "N/A",
                productType: p.product?.type || "N/A",
                boxes: Number(p.boxes) || 0,
                price: Number(p.price) || 0,
              })) || [],

            amount,
            gst,
            totalAmountWithGST,
            deliveryCharge,
            totalAmountWithDelivery,

            paidAmount,
            remainingAmount,

            paymentPercentage:
              totalAmountWithDelivery > 0
                ? ((paidAmount / totalAmountWithDelivery) * 100).toFixed(2)
                : "0",

            paymentHistory: payment.paymentHistory.map((entry) => ({
              referenceId: entry.referenceId,
              paymentMode: entry.paymentMode,
              bankName:
                entry.paymentMode === "online" ? entry.bankName : null,
              screenshotUrl: entry.screenshotUrl,
              submittedAmount: Number(entry.submittedAmount),
              verifiedAmount: Number(entry.verifiedAmount),
              status: entry.status,
              verifiedBy: entry.verifiedBy,
              verificationNotes: entry.verificationNotes,
              submissionDate: entry.submissionDate,
              verificationDate: entry.verificationDate,
            })),

            paymentMethod: payment.orderDetails?.paymentMethod || "N/A",
            paymentStatus: payment.status,
            orderStatus: payment.orderDetails?.orderStatus || "N/A",

            shippingAddress: payment.orderDetails?.shippingAddress || {},
            firmName:
              payment.orderDetails?.firmName ||
              payment.user?.customerDetails?.firmName ||
              "N/A",
            gstNumber: payment.orderDetails?.gstNumber || "N/A",

            createdAt: payment.createdAt,
            updatedAt: payment.updatedAt,
          };
        })
      );

      res.json({
        count: formattedPayments.length,
        partialPayments: formattedPayments,
      });

    } catch (error) {
      console.error("Error fetching partial payments:", error);
      res.status(500).json({
        error: "Error fetching partial payments",
        details: error.message,
      });
    }
  },

  getPaymentDetails: async (req, res) => {
    try {
      const { paymentId } = req.params;

      const payment = await Payment.findById(paymentId)
        .populate("user", "name phoneNumber email customerDetails")
        .populate({
          path: "orderDetails",
          populate: {
            path: "products.product",
            select: "name type price",
          },
        })
        .populate("paymentHistory.verifiedBy", "name");

      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }

      // ✅ BASE AMOUNT
      let amount = 0;

      if (payment.orderDetails) {
        amount = Number(payment.orderDetails.totalAmount || 0);
      } else {
        amount = Number(payment.amount || 0);
      }

      // ✅ GST (5%)
      const gst = Number((amount * 0.05).toFixed(2));

      const totalAmountWithGST = Number((amount + gst).toFixed(2));

      // ✅ FETCH CHALLANS
      let challans = [];
      try {
        if (payment.orderDetails?._id) {
          challans = await Challan.find({
            originalOrder: payment.orderDetails._id,
          }).lean();
        }
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

      const paidAmount = Number(payment.paidAmount) || 0;

      res.json({
        payment: {
          paymentId: payment._id,

          // ✅ USER
          user: {
            name: payment.user?.name,
            email: payment.user?.email,
            phoneNumber: payment.user?.phoneNumber,
            customerDetails: payment.user?.customerDetails,
          },

          // ✅ ORDER
          order: payment.orderDetails
            ? {
              orderId: payment.orderDetails._id,
              orderStatus: payment.orderDetails.orderStatus,

              // ✅ CORRECT VALUES
              amount,
              gst,
              totalAmountWithGST,
              deliveryCharge,
              totalAmountWithDelivery,

              products: payment.orderDetails.products.map((item) => ({
                productId: item.product?._id,
                name: item.product?.name,
                type: item.product?.type,
                price: item.product?.price,
                boxes: item.boxes,
              })),
            }
            : null,

          // ✅ PAYMENT HISTORY
          paymentHistory: payment.paymentHistory.map((entry) => ({
            referenceId: entry.referenceId,
            paymentMode: entry.paymentMode || "online",
            bankName: entry.bankName || "N/A",
            screenshotUrl: entry.screenshotUrl,
            submittedAmount: Number(entry.submittedAmount),
            verifiedAmount: Number(entry.verifiedAmount),
            status: entry.status,
            verifiedBy: entry.verifiedBy?.name,
            verificationNotes: entry.verificationNotes,
            submissionDate: entry.submissionDate,
            verificationDate: entry.verificationDate,
          })),

          // ✅ SUMMARY
          paymentType: payment.paymentType || "online",
          status: payment.status,

          amount,
          gst,
          totalAmountWithGST,
          deliveryCharge,
          totalAmountWithDelivery,

          paidAmount,
          remainingAmount: totalAmountWithDelivery - paidAmount,
        },
      });

    } catch (error) {
      console.error("Payment Details Error:", error);
      res.status(500).json({
        error: error.message,
      });
    }
  },

  getSubmittedPayments: async (req, res) => {
    try {
      const payments = await Payment.find({ status: "submitted" })
        .populate(
          "user",
          "name email phoneNumber customerDetails.firmName customerDetails.userCode"
        )
        .populate(
          "orderDetails",
          "totalAmountWithDelivery paymentMethod shippingAddress orderStatus"
        )
        .sort({ createdAt: -1 });

      const formattedPayments = payments.map((payment) => ({
        ...payment.toObject(),
        amount: Number(payment.amount),
        paidAmount: Number(payment.paidAmount),
        remainingAmount: Number(payment.remainingAmount),
        paymentHistory: payment.paymentHistory.map((entry) => ({
          ...entry.toObject(),
          submittedAmount: Number(entry.submittedAmount),
          verifiedAmount: Number(entry.verifiedAmount),
        })),
        orderDetails: payment.orderDetails ? {
          ...payment.orderDetails.toObject(),
          totalAmountWithDelivery: Number(
            payment.orderDetails.totalAmountWithDelivery
          ),
        } : null,
      }));

      res.json({ payments: formattedPayments });
    } catch (error) {
      console.error("Error fetching submitted payments:", error);
      res.status(500).json({
        error: "Error fetching submitted payments",
        details: error.message,
      });
    }
  },

  verifyPayment: async (req, res) => {
    try {
      const { paymentId } = req.params;
      const { verifiedAmount, verificationNotes, status } = req.body;

      if (!verifiedAmount) {
        return res.status(400).json({
          error: "Verified amount is required",
        });
      }

      const numericVerifiedAmount = Number(verifiedAmount);
      if (isNaN(numericVerifiedAmount) || numericVerifiedAmount < 0) {
        return res.status(400).json({
          error: "Verified amount must be a valid positive number",
        });
      }

      const payment = await Payment.findById(paymentId);
      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }

      if (payment.status !== "submitted") {
        return res.status(400).json({
          error: "Only submitted payments can be verified",
        });
      }

      // Find the latest submitted payment entry
      const latestSubmission = payment.paymentHistory
        .filter(entry => entry.status === "submitted")
        .sort((a, b) => new Date(b.submissionDate) - new Date(a.submissionDate))[0];

      if (!latestSubmission) {
        return res.status(400).json({
          error: "No submitted payment found to verify",
        });
      }

      // Update the payment history entry
      latestSubmission.status = status || "verified";
      latestSubmission.verifiedAmount = numericVerifiedAmount;
      latestSubmission.verifiedBy = req.user._id;
      latestSubmission.verificationNotes = verificationNotes;
      latestSubmission.verificationDate = new Date();

      // Update payment totals
      payment.paidAmount = (payment.paidAmount || 0) + numericVerifiedAmount;

      if (payment.paidAmount >= payment.amount) {
        payment.status = "completed";
      } else {
        payment.status = "verified_partial";
      }

      await payment.save();

      res.json({
        message: "Payment verified successfully",
        payment: {
          paymentId: payment._id,
          verifiedAmount: numericVerifiedAmount,
          totalAmount: payment.amount,
          paidAmount: payment.paidAmount,
          remainingAmount: payment.remainingAmount,
          status: payment.status,
          verificationNotes: verificationNotes,
          verifiedBy: req.user.name,
        },
      });
    } catch (error) {
      console.error("Error verifying payment:", error);
      res.status(500).json({
        error: "Error verifying payment",
        details: error.message,
      });
    }
  },

  downloadPendingPaymentsExcel: async (req, res) => {
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
            deliveryCharge: 0,
            totalAmountWithDelivery: Number(payment.amount) || 0,
            paymentMethod: "N/A",
            paymentStatus: payment.status,
            orderStatus: "N/A",
            shippingAddress: {},
            firmName: payment.user?.customerDetails?.firmName || "N/A",
            gstNumber: "N/A",
            createdAt: payment.createdAt,
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
            boxes: Number(p.boxes) || 0,
            price: Number(p.price) || 0,
          })),
          totalAmount: Number(payment.amount) || 0,
          paidAmount: Number(payment.paidAmount) || 0,
          remainingAmount: Number(payment.remainingAmount) || 0,
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
        { header: "Delivery Charge", key: "deliveryCharge", width: 15 },
        { header: "Total with Delivery", key: "totalAmountWithDelivery", width: 20 },
        { header: "Payment Method", key: "paymentMethod", width: 15 },
        { header: "Payment Status", key: "paymentStatus", width: 15 },
        { header: "Order Status", key: "orderStatus", width: 15 },
        { header: "GST Number", key: "gstNumber", width: 15 },
        { header: "Created Date", key: "createdAt", width: 20 },
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
            .map((p) => `${p.productName} (${p.boxes} boxes)`)
            .join(", "),
          totalAmount: payment.totalAmount,
          paidAmount: payment.paidAmount,
          remainingAmount: payment.remainingAmount,
          deliveryCharge: payment.deliveryCharge,
          totalAmountWithDelivery: payment.totalAmountWithDelivery,
          paymentMethod: payment.paymentMethod,
          paymentStatus: payment.paymentStatus,
          orderStatus: payment.orderStatus,
          gstNumber: payment.gstNumber,
          createdAt: payment.createdAt.toLocaleDateString(),
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
  }
};

module.exports = receptionController;
