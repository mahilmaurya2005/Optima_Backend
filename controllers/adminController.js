const cloudinary = require("../config/cloudinary");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const MarketingActivity = require("../models/MarketingActivity");
const Attendance = require("../models/Attendance");
const UserActivity = require("../models/UserActivity");
const ExcelJS = require("exceljs");
const Stock = require("../models/Stock");
const Banner = require("../models/Banner");
const Payment = require("../models/Payment");
const mongoose = require("mongoose");
// const RawMaterialEntry = require("../models/RawMaterialEntry");
// const ProductionOutcome = require("../models/ProductionOutcome");
// const RawMaterial = require("../models/RawMaterial");
// const OutcomeItem = require("../models/OutcomeItem");
const { Parser } = require('json2csv');
const excel4node = require('excel4node');
const Challan = require("../models/Challan");
const RawMaterial = require("../models/RawMaterial");
const OutcomeItem = require("../models/OutcomeItem");
const RawMaterialEntry = require("../models/RawMaterialEntry");
const ProductionOutcome = require("../models/ProductionOutcome");
const Wastage = require("../models/Wastage");
const Formula = require("../models/Formula");
const Category = require("../models/Category");
const DirectUsage = require("../models/DirectUsage");
const PreformProduction = require("../models/PreformProduction");
const CapProduction = require("../models/CapProduction");
const BottleProduction = require("../models/BottleProduction");
const roundAmount = require("../utils/roundAmount");


const adminController = {
  getAllStaff: async (req, res) => {
    try {
      const validStaffRoles = [
        "reception",
        "stock",
        "dispatch",
        "marketing",
        "miscellaneous",
        "sales",
      ];

      const staff = await User.find({
        role: { $in: validStaffRoles },
      })
        .select(
          "name email phoneNumber role originalPassword isActive createdAt"
        )
        .sort({ createdAt: -1 });

      const roleSummary = staff.reduce((acc, member) => {
        acc[member.role] = (acc[member.role] || 0) + 1;
        return acc;
      }, {});

      res.json({
        staff: staff.map((member) => ({
          _id: member._id,
          name: member.name,
          email: member.email,
          phoneNumber: member.phoneNumber,
          role: member.role,
          isActive: member.isActive,
          createdAt: member.createdAt,
        })),
        summary: {
          total: staff.length,
          byRole: roleSummary,
        },
      });
    } catch (error) {
      console.error("Error fetching staff members:", error);
      res.status(500).json({ error: "Error fetching staff members" });
    }
  },

  deleteStaff: async (req, res) => {
    try {
      const { staffId } = req.params;

      if (!staffId) {
        return res.status(400).json({ error: "Staff ID is required" });
      }

      const staff = await User.findById(staffId);
      if (!staff) {
        return res.status(404).json({ error: "Staff member not found" });
      }

      const validStaffRoles = [
        "reception",
        "stock",
        "dispatch",
        "marketing",
        "miscellaneous",
      ];
      if (!validStaffRoles.includes(staff.role)) {
        return res.status(400).json({ error: "Invalid staff member" });
      }

      await User.findByIdAndDelete(staffId);

      res.json({
        message: "Staff member deleted successfully",
        deletedStaff: {
          _id: staff._id,
          name: staff.name,
          email: staff.email,
          role: staff.role,
        },
      });
    } catch (error) {
      console.error("Error deleting staff member:", error);

      if (error.name === "CastError") {
        return res.status(400).json({ error: "Invalid staff ID format" });
      }

      res.status(500).json({ error: "Error deleting staff member" });
    }
  },

  getAllUsers: async (req, res) => {
    try {
      const users = await User.find({ role: "user" })
        .select(
          "name email phoneNumber customerDetails.firmName customerDetails.userCode isActive createdAt"
        )
        .sort({ createdAt: -1 });

      res.json({
        users: users.map((user) => ({
          // _id: user._id,
          userCode: user.customerDetails?.userCode,
          name: user.name,
          email: user.email,
          phoneNumber: user.phoneNumber,
          firmName: user.customerDetails?.firmName,
          isActive: user.isActive,
          createdAt: user.createdAt,
        })),
      });
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ error: "Error fetching users" });
    }
  },

  getUserActivityHistory: async (req, res) => {
    try {
      const { userId } = req.params;
      const { startDate, endDate } = req.query;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const activityHistory = await UserActivity.findOne({ user: userId });
      if (!activityHistory) {
        return res.status(404).json({ error: "No activity history found" });
      }

      let orderQuery = { user: userId };
      if (startDate && endDate) {
        orderQuery.createdAt = {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        };
      }
      const orders = await Order.find(orderQuery)
        .select("createdAt totalAmount orderStatus")
        .sort({ createdAt: -1 });

      const periods = activityHistory.activityPeriods.map((period) => ({
        startDate: period.startDate,
        endDate: period.endDate || new Date(),
        status: period.status,
        duration: Math.ceil(
          (period.endDate || new Date() - period.startDate) /
          (1000 * 60 * 60 * 24)
        ),
      }));

      res.json({
        userId,
        userName: user.name,
        currentStatus: user.isActive ? "active" : "inactive",
        activityPeriods: periods,
        orders: orders.map((order) => ({
          orderId: order._id,
          date: order.createdAt,
          amount: order.totalAmount,
          status: order.orderStatus,
        })),
      });
    } catch (error) {
      console.error("Error fetching user activity:", error);
      res.status(500).json({ error: "Error fetching user activity history" });
    }
  },

  toggleUserStatus: async (req, res) => {
    try {
      const { userCode } = req.params;
      const user = await User.findOne({ "customerDetails.userCode": userCode });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.role !== "user") {
        return res
          .status(403)
          .json({ error: "Cannot modify admin user status" });
      }

      const newStatus = !user.isActive;
      user.isActive = newStatus;

      let userActivity = await UserActivity.findOne({ user: user._id });

      if (!userActivity) {
        userActivity = new UserActivity({
          user: user._id,
          activityPeriods: [
            {
              startDate: user.createdAt,
              status: "active",
            },
          ],
        });
      }

      const lastPeriod =
        userActivity.activityPeriods[userActivity.activityPeriods.length - 1];
      if (lastPeriod && !lastPeriod.endDate) {
        lastPeriod.endDate = new Date();
      }

      userActivity.activityPeriods.push({
        startDate: new Date(),
        status: newStatus ? "active" : "inactive",
      });

      await Promise.all([user.save(), userActivity.save()]);

      res.json({
        message: `User ${newStatus ? "activated" : "deactivated"} successfully`,
        userCode: user.customerDetails.userCode,
        isActive: newStatus,
      });
    } catch (error) {
      console.error("Error toggling user status:", error);
      res.status(500).json({ error: "Error updating user status" });
    }
  },

  deleteUser: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { userCode } = req.params;

      // 🔍 Find user
      const user = await User.findOne({
        "customerDetails.userCode": userCode,
      }).session(session);

      if (!user) {
        await session.abortTransaction();
        return res.status(404).json({ error: "User not found" });
      }

      if (user.role !== "user") {
        await session.abortTransaction();
        return res.status(403).json({
          error: "Cannot delete admin or staff user",
        });
      }

      const userId = user._id;

      // 🔥 1. Get all orders of user
      const orders = await Order.find({ user: userId }).session(session);
      const orderIds = orders.map((o) => o._id);

      // 🔥 2. Delete Challans linked to orders
      await Challan.deleteMany({
        originalOrder: { $in: orderIds },
      }).session(session);

      // 🔥 3. Delete Payments
      await Payment.deleteMany({
        orderDetails: { $in: orderIds },
      }).session(session);

      // 🔥 4. Restore stock (VERY IMPORTANT)
      for (const order of orders) {
        for (const item of order.products) {
          const product = await Product.findById(item.product).session(session);

          if (product) {
            product.boxes += item.boxes;

            product.stockRemarks.push({
              message: `Restored ${item.boxes} boxes (user deleted)`,
              updatedBy: req.user._id,
              boxes: item.boxes,
              changeType: "user_delete_restore",
            });

            await product.save({ session });
          }
        }
      }

      // 🔥 5. Delete Orders
      await Order.deleteMany({ user: userId }).session(session);

      // 🔥 6. Delete UserActivity (if exists)
      await UserActivity.deleteMany({ user: userId }).session(session);

      // 🔥 7. Finally delete user
      await User.deleteOne({ _id: userId }).session(session);

      await session.commitTransaction();
      session.endSession();

      res.json({
        message: "User and all related data deleted successfully",
        userCode,
      });

    } catch (error) {
      await session.abortTransaction();
      session.endSession();

      console.error("Delete user error:", error);

      res.status(500).json({
        error: "Error deleting user",
        details: error.message,
      });
    }
  },

  createProduct: async (req, res) => {
    try {
      const {
        name,
        type,
        category,
        description,
        originalPrice,
        discountedPrice,
        boxes,
        bottlesPerBox,
        validFrom,
        validTo,
      } = req.body;

      const validCategories = Product.getCategoriesByType(type);
      if (!validCategories.includes(category)) {
        return res.status(400).json({
          error: `Invalid category for ${type}. Valid categories are: ${validCategories.join(
            ", "
          )}`,
        });
      }

      if (!boxes || Number(boxes) < 230) {
        return res.status(400).json({
          error: "Minimum 230 boxes are required",
        });
      }

      if (!bottlesPerBox || Number(bottlesPerBox) < 1) {
        return res.status(400).json({
          error: "bottlesPerBox must be at least 1",
        });
      }

      // ✅ DECIMAL FIX START
      const parsedOriginalPrice = parseFloat(originalPrice);
      const parsedDiscountedPrice =
        discountedPrice !== undefined && discountedPrice !== null
          ? parseFloat(discountedPrice)
          : null;

      if (isNaN(parsedOriginalPrice)) {
        return res.status(400).json({
          error: "Original price must be a valid number",
        });
      }

      if (
        parsedDiscountedPrice !== null &&
        isNaN(parsedDiscountedPrice)
      ) {
        return res.status(400).json({
          error: "Discounted price must be a valid number",
        });
      }
      // ✅ DECIMAL FIX END

      if (parsedDiscountedPrice !== null) {
        if (!validFrom || !validTo) {
          return res.status(400).json({
            error:
              "validFrom and validTo dates are required when setting a discounted price",
          });
        }

        const fromDate = new Date(validFrom);
        const toDate = new Date(validTo);

        if (fromDate > toDate) {
          return res.status(400).json({
            error: "validTo date must be after validFrom date",
          });
        }
      }

      let imageUrl = null;

      if (req.file) {
        const b64 = req.file.buffer.toString("base64");
        const dataURI = `data:${req.file.mimetype};base64,${b64}`;

        const result = await cloudinary.uploader.upload(dataURI, {
          folder: "products",
          resource_type: "auto",
        });

        imageUrl = result.secure_url;
      }

      const product = new Product({
        name,
        type,
        category,
        description,
        originalPrice: Number(parsedOriginalPrice.toFixed(2)),
        discountedPrice:
          parsedDiscountedPrice !== null
            ? Number(parsedDiscountedPrice.toFixed(2))
            : null,

        boxes: Number(boxes),
        bottlesPerBox: Number(bottlesPerBox),
        image: imageUrl,
        validFrom: validFrom || null,
        validTo: validTo || null,
      });

      await product.save();

      res.status(201).json({ product });

    } catch (error) {
      console.error("Error creating product:", error);
      res.status(500).json({
        error: error.message || "Error creating product",
      });
    }
  },

  getCategories: async (req, res) => {
    try {
      const { type } = req.query;
      if (!type) {
        return res.status(400).json({ error: "Type parameter is required" });
      }

      const categories = Product.getCategoriesByType(type);
      res.json({ categories });
    } catch (error) {
      res.status(500).json({ error: "Error fetching categories" });
    }
  },

  getFullStockHistory: async (req, res) => {
    try {
      const { startDate, endDate, productId } = req.query;
      let query = {};
      if (startDate && endDate) {
        query["updateHistory.updatedAt"] = {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        };
      }
      if (productId) {
        query.productId = productId;
      }
      const stockHistory = await Stock.find(query)
        .populate("productId", "name description")
        .populate("updatedBy", "name email role")
        .populate("updateHistory.updatedBy", "name email role")
        .sort({ "updateHistory.updatedAt": -1 });

      const formattedHistory = stockHistory
        .filter(stock => stock.productId) // Filter out stocks with null productId
        .map((stock) => {
          const stockAdditions = stock.updateHistory
            .filter(
              (update) =>
                update.updatedBy?.role === "stock" &&
                update.changeType === "addition" &&
                update.boxes > 0
            )
            .map((update) => ({
              quantity: update.boxes,
              date: update.updatedAt,
              updatedBy: update.updatedBy ? {
                id: update.updatedBy._id,
                name: update.updatedBy.name,
                email: update.updatedBy.email,
              } : null,
            }));

          const totalAddedByStock = stockAdditions.reduce(
            (sum, addition) => sum + (addition.quantity || 0),
            0
          );

          return {
            productId: stock.productId._id,
            productName: stock.productId.name,
            productDescription: stock.productId.description,
            currentQuantity: stock.quantity,
            lastUpdated: stock.lastUpdated,
            lastUpdatedBy: stock.updatedBy ? {
              id: stock.updatedBy._id,
              name: stock.updatedBy.name,
              email: stock.updatedBy.email,
              role: stock.updatedBy.role,
            } : null,
            stockAdditionHistory: stockAdditions,
            totalAddedByStock,
            updateHistory: stock.updateHistory.map((update) => ({
              quantity: update.boxes,
              updatedAt: update.updatedAt,
              updatedBy: update.updatedBy ? {
                id: update.updatedBy._id,
                name: update.updatedBy.name,
                email: update.updatedBy.email,
                role: update.updatedBy.role,
              } : null,
              changeType: update.changeType,
              notes: update.notes,
            })),
          };
        });

      const summary = {
        totalRecords: stockHistory.length,
        totalUpdates: stockHistory.reduce(
          (sum, stock) => sum + stock.updateHistory.length,
          0
        ),
        productsTracked: new Set(
          stockHistory
            .filter(stock => stock.productId)
            .map((stock) => stock.productId._id.toString())
        ).size,
        totalAddedByStock: formattedHistory.reduce(
          (sum, item) => sum + item.totalAddedByStock,
          0
        ),
      };

      res.json({
        success: true,
        history: formattedHistory,
        summary,
      });
    } catch (error) {
      console.error("Error fetching full stock history:", error);
      res.status(500).json({
        success: false,
        error: "Error fetching stock history",
        details: error.message,
      });
    }
  },

  downloadFullStockHistory: async (req, res) => {
    try {
      const { startDate, endDate, productId } = req.query;

      let query = {};

      if (startDate && endDate) {
        query["updateHistory.updatedAt"] = {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        };
      }

      if (productId) {
        query.productId = productId;
      }

      const stockHistory = await Stock.find(query)
        .populate("productId", "name description")
        .populate("updatedBy", "name email role")
        .populate("updateHistory.updatedBy", "name email role")
        .sort({ "updateHistory.updatedAt": -1 });

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Stock History");

      // Define column headers
      worksheet.columns = [
        { header: "Product ID", key: "productId", width: 25 },
        { header: "Product Name", key: "productName", width: 20 },
        { header: "Description", key: "productDescription", width: 30 },
        { header: "Current Quantity", key: "currentQuantity", width: 15 },
        { header: "Last Updated", key: "lastUpdated", width: 20 },
        { header: "Last Updated By", key: "lastUpdatedBy", width: 20 },
        { header: "Update Date", key: "updateDate", width: 20 },
        { header: "Update Boxes", key: "updateBoxes", width: 15 },
        { header: "Change Type", key: "changeType", width: 15 },
        { header: "Updated By", key: "updatedBy", width: 20 },
        { header: "Stock Addition", key: "stockAddition", width: 15 },
        { header: "Total Added by Stock", key: "totalAddedByStock", width: 20 },
        { header: "Notes", key: "notes", width: 30 },
      ];

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).alignment = {
        vertical: "middle",
        horizontal: "center",
      };
      worksheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFDDDDDD" },
      };

      stockHistory.forEach((stock) => {
        const totalAddedByStock = stock.updateHistory
          .filter(
            (update) =>
              update.updatedBy?.role === "stock" &&
              update.changeType === "addition" &&
              update.boxes > 0
          )
          .reduce((sum, update) => sum + (update.boxes || 0), 0);

        stock.updateHistory.forEach((update) => {
          const isStockAddition =
            update.updatedBy?.role === "stock" &&
            update.changeType === "addition" &&
            update.boxes > 0;

          worksheet.addRow({
            productId: stock.productId._id.toString(),
            productName: stock.productId.name,
            productDescription: stock.productId.description,
            currentQuantity: stock.quantity,
            lastUpdated: stock.lastUpdated.toLocaleString(),
            lastUpdatedBy: stock.updatedBy?.name || "N/A",
            updateDate: update.updatedAt.toLocaleString(),
            updateBoxes: update.boxes || "",
            changeType: update.changeType,
            updatedBy: update.updatedBy?.name || "N/A",
            stockAddition: isStockAddition ? update.boxes : "",
            totalAddedByStock: totalAddedByStock || 0,
            notes: update.notes || "N/A",
          });
        });
      });

      const totalStockAddedAcrossAll = stockHistory.reduce((sum, stock) => {
        const stockTotal = stock.updateHistory
          .filter(
            (update) =>
              update.updatedBy?.role === "stock" &&
              update.changeType === "addition" &&
              update.boxes > 0
          )
          .reduce((subSum, update) => subSum + (update.boxes || 0), 0);
        return sum + stockTotal;
      }, 0);

      worksheet.addRow({
        productId: "Summary",
        totalAddedByStock: totalStockAddedAcrossAll,
      });

      const lastRow = worksheet.lastRow;
      lastRow.font = { bold: true };
      lastRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFDDDD" },
      };

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="Full_Stock_History.xlsx"'
      );

      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error("Error generating stock history Excel:", error);
      res
        .status(500)
        .json({ error: "Error generating stock history Excel file" });
    }
  },

  getAllProducts: async (req, res) => {
    try {
      const { type, category } = req.query;
      let query = { isActive: true };

      if (type) {
        query.type = type;
        if (category) {
          const validCategories = Product.getCategoriesByType(type);
          if (!validCategories.includes(category)) {
            return res
              .status(400)
              .json({ error: "Invalid category for the selected type" });
          }
          query.category = category;
        }
      }

      const products = await Product.find(query)
        .populate({
          path: "stockRemarks.updatedBy",
          select: "name",
        })
        .sort({ "stockRemarks.updatedAt": -1 });

      const formattedProducts = products.map((product) => {
        const productObj = product.toObject({ virtuals: true });
        const now = new Date();
        const isOfferValid =
          productObj.discountedPrice &&
          productObj.validFrom &&
          productObj.validTo &&
          now >= productObj.validFrom &&
          now <= productObj.validTo;

        if (!isOfferValid) {
          delete productObj.discountedPrice;
          delete productObj.discountPercentage;
          delete productObj.discountTag;
          delete productObj.offerEndsIn;
        } else {
          productObj.discountPercentage = Math.round(
            ((productObj.originalPrice - productObj.discountedPrice) /
              productObj.originalPrice) *
            100
          );
        }

        if (productObj.stockRemarks && productObj.stockRemarks.length > 0) {
          productObj.stockUpdateInfo = {
            lastUpdate: {
              message: productObj.stockRemarks[0].message,
              updatedBy:
                productObj.stockRemarks[0].updatedBy?.name || "Unknown User",
              updatedAt: productObj.stockRemarks[0].updatedAt,
              boxes: productObj.stockRemarks[0].boxes,
              changeType: productObj.stockRemarks[0].changeType,
            },
            totalUpdates: productObj.stockRemarks.length,
          };
        }

        return productObj;
      });

      res.json({ products: formattedProducts });
    } catch (error) {
      console.error("Error in admin getAllProducts:", error);
      res.status(500).json({ error: "Error fetching products" });
    }
  },

  deleteProduct: async (req, res) => {
    try {
      const product = await Product.findByIdAndDelete(req.params.productId);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      res.json({ message: "Product deleted successfully" });
    } catch (error) {
      res.status(500).json({ error: "Error deleting product" });
    }
  },

  updateProduct: async (req, res) => {
    try {
      const updates = {
        ...req.body,
        originalPrice: req.body.originalPrice
          ? Number(req.body.originalPrice)
          : undefined,
        discountedPrice: req.body.discountedPrice
          ? Number(req.body.discountedPrice)
          : null,
        boxes: req.body.boxes ? Number(req.body.boxes) : undefined,
        bottlesPerBox: req.body.bottlesPerBox
          ? Number(req.body.bottlesPerBox)
          : undefined,
        validFrom: req.body.validFrom || null,
        validTo: req.body.validTo || null,
      };

      if (updates.boxes && updates.boxes < 230) {
        return res.status(400).json({
          error: "Minimum 230 boxes are required",
        });
      }

      if (updates.bottlesPerBox && updates.bottlesPerBox < 1) {
        return res.status(400).json({
          error: "bottlesPerBox must be at least 1",
        });
      }

      const oldProduct = await Product.findById(req.params.productId);
      if (!oldProduct) {
        return res.status(404).json({ error: "Product not found" });
      }

      const priceChanged =
        (updates.originalPrice !== undefined &&
          updates.originalPrice !== oldProduct.originalPrice) ||
        (updates.discountedPrice !== undefined &&
          updates.discountedPrice !== oldProduct.discountedPrice);

      if (priceChanged) {
        const pendingOrders = await Order.find({
          orderStatus: "pending",
          "products.product": req.params.productId,
        });

        for (const order of pendingOrders) {
          for (const item of order.products) {
            if (item.product.toString() === req.params.productId) {
              if (!item.originalPrice) {
                item.originalPrice = item.price;
              }

              const now = new Date();
              const isOfferValid =
                updates.discountedPrice &&
                updates.validFrom &&
                updates.validTo &&
                now >= new Date(updates.validFrom) &&
                now <= new Date(updates.validTo);

              const newPrice = isOfferValid
                ? updates.discountedPrice
                : updates.originalPrice;

              if (item.price !== newPrice) {
                order.priceUpdateHistory.push({
                  product: item.product,
                  oldPrice: item.price,
                  newPrice: newPrice,
                  updatedBy: req.user._id,
                  updatedAt: new Date(),
                });

                item.price = newPrice;
                order.priceUpdated = true;
              }
            }
          }

          order.totalAmount = order.products.reduce(
            (sum, item) => sum + item.price * item.boxes,
            0
          );
          order.totalAmountWithDelivery =
            order.totalAmount + (order.deliveryCharge || 0);
          await order.save();

          const payment = await Payment.findOne({ orderDetails: order._id });
          if (payment) {
            payment.amount = order.totalAmountWithDelivery;
            payment.remainingAmount = payment.amount - payment.paidAmount;
            await payment.save();
          }
        }
      }

      if (req.file) {
        const b64 = Buffer.from(req.file.buffer).toString("base64");
        const dataURI = `data:${req.file.mimetype};base64,${b64}`;

        const result = await cloudinary.uploader.upload(dataURI, {
          folder: "products",
          resource_type: "auto",
        });

        updates.image = result.secure_url;

        if (oldProduct.image) {
          const publicId = oldProduct.image.split("/").pop().split(".")[0];
          await cloudinary.uploader.destroy(`products/${publicId}`);
        }
      }

      const product = await Product.findByIdAndUpdate(
        req.params.productId,
        updates,
        { new: true }
      );

      if (!product) return res.status(404).json({ error: "Product not found" });

      res.json({ product });
    } catch (error) {
      console.error("Error updating product:", error);
      res.status(500).json({ error: "Error updating product" });
    }
  },

  getPreviewOrders: async (req, res) => {
    try {
      const orders = await Order.find({ orderStatus: "preview" })
        .populate(
          "user",
          "name email phoneNumber customerDetails.firmName customerDetails.userCode"
        )
        .populate("products.product", "name type originalPrice discountedPrice validFrom validTo")
        .populate("statusHistory.updatedBy", "name role")
        .sort({ createdAt: -1 });

      // Format orders to include price update information
      const formattedOrders = await Promise.all(
        orders.map(async (order) => {
          let priceChanged = false;
          const priceUpdateDetails = [];

          // Check each product for price updates
          const updatedProducts = await Promise.all(
            order.products.map(async (item) => {
              const product = item.product; // Populated product
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

              // Check if the stored price differs from the current price
              if (item.price !== currentPrice) {
                priceChanged = true;
                priceUpdateDetails.push({
                  product: item.product._id,
                  oldPrice: item.price,
                  newPrice: currentPrice,
                });
              }

              return {
                productId: item.product._id,
                name: item.product.name,
                type: item.product.type,
                boxes: item.boxes,
                price: item.price, // Stored price
                currentPrice, // Current price from Product model
                isOfferValid,
              };
            })
          );

          // Recalculate total amount if prices have changed
          const totalAmount = updatedProducts.reduce(
            (sum, item) => sum + item.currentPrice * item.boxes,
            0
          );
          const amount = Number(order.totalAmount || 0);
          const gst = Number((amount * 0.05).toFixed(2));
          const totalAmountWithGST = Number((amount + gst).toFixed(2));
          const deliveryCharge = Number(order.deliveryCharge || 0);
          const totalAmountWithDelivery = roundAmount(
            totalAmountWithGST + deliveryCharge
          );

          const currentGST = Number((totalAmount * 0.05).toFixed(2));
          const currentTotalAmountWithGST = Number(
            (totalAmount + currentGST).toFixed(2)
          );
          const currentTotalAmountWithDelivery = roundAmount(
            currentTotalAmountWithGST + deliveryCharge
          );

          return {
            _id: order._id,
            orderId: order.orderId,
            user: order.user
              ? {
                name: order.user.name,
                email: order.user.email,
                phoneNumber: order.user.phoneNumber,
                firmName: order.user.customerDetails?.firmName,
                userCode: order.user.customerDetails?.userCode,
              }
              : null,
            products: updatedProducts,
            totalAmount: order.totalAmount, // Stored total
            currentTotalAmount: totalAmount, // Recalculated total based on current prices
            amount,
            gst,
            totalAmountWithGST,
            deliveryCharge,
            totalAmountWithDelivery,
            currentGST,
            currentTotalAmountWithGST,
            currentTotalAmountWithDelivery,
            priceUpdated: order.priceUpdated || priceChanged,
            priceUpdateDetails: priceChanged ? priceUpdateDetails : undefined,
            orderStatus: order.orderStatus,
            paymentStatus: order.paymentStatus,
            paymentMethod: order.paymentMethod,
            shippingAddress: order.shippingAddress,
            firmName: order.firmName,
            gstNumber: order.gstNumber,
            createdAt: order.createdAt,
            statusHistory: order.statusHistory.map((history) => ({
              status: history.status,
              updatedBy: history.updatedBy
                ? { name: history.updatedBy.name, role: history.updatedBy.role }
                : null,
              updatedAt: history.updatedAt,
            })),
          };
        })
      );

      res.json({
        orders: formattedOrders,
        totalOrders: formattedOrders.length,
        summary: {
          totalPriceUpdatedOrders: formattedOrders.filter((order) => order.priceUpdated).length,
        },
      });
    } catch (error) {
      console.error("Error fetching preview orders:", error);
      res.status(500).json({ error: "Error fetching preview orders", details: error.message });
    }
  },

  processPreviewOrder: async (req, res) => {
    try {
      const { orderId } = req.params;
      console.log("Processing orderId:", orderId);

      const order = await Order.findById(orderId).populate("products.product");
      if (!order) {
        return res.status(400).json({ error: "Order not found" });
      }
      if (order.orderStatus !== "preview") {
        return res.status(400).json({ error: "Invalid preview order status" });
      }

      if (!req.user || !req.user._id) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Check for price updates
      let totalAmount = 0;
      let priceChanged = false;
      const priceUpdateHistory = [];

      for (const item of order.products) {
        const product = await Product.findById(item.product._id);
        if (!product || !product.isActive) {
          return res
            .status(400)
            .json({
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
            updatedAt: new Date(),
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
          payment.remainingAmount = payment.amount - payment.paidAmount;
          await payment.save();
        }
      }

      order.userActivityStatus = order.userActivityStatus || "active";
      order._updatedBy = req.user._id;
      order.orderStatus = "processing";

      await order.save();
      console.log("Order updated to processing:", order);

      res.json({
        message: "Order moved to processing",
        order,
        priceUpdated: priceChanged,
        priceUpdateDetails: priceChanged ? priceUpdateHistory : undefined,
      });
    } catch (error) {
      console.error("Error processing order:", error);
      res
        .status(500)
        .json({ error: "Error processing order", details: error.message });
    }
  },


  getAllOrders: async (req, res) => {
    try {
      const { type, priceUpdated } = req.query;
      let query = {};


      if (type && ["Bottle", "Raw Material", "all"].includes(type)) {
        if (type !== "all") {
          query.type = type;
        }
      }


      if (priceUpdated !== undefined) {
        query.priceUpdated = priceUpdated === "true";
      }

      const orders = await Order.find(query)
        .select(
          "orderId firmName gstNumber shippingAddress paymentStatus paymentMethod orderStatus createdAt type totalAmount totalAmountWithDelivery priceUpdated priceUpdateHistory products"
        )
        .populate(
          "user",
          "name email phoneNumber customerDetails.firmName customerDetails.userCode"
        )
        .populate("products.product", "name type originalPrice discountedPrice validFrom validTo")
        .populate("priceUpdateHistory.updatedBy", "name role")
        .sort({ createdAt: -1 });

      const groupedOrders = {
        all: orders,
        Bottle: orders.filter((order) => order.type === "Bottle"),
        "Raw Material": orders.filter((order) => order.type === "Raw Material"),
      };

      const responseOrders = type
        ? type === "all"
          ? orders
          : groupedOrders[type]
        : orders;


      const formattedOrders = await Promise.all(
        responseOrders.map(async (order) => {
          const challans = await Challan.find({
            originalOrder: order._id,
          }).lean();

          const amount = Number(order.totalAmount || 0);
          const gst = Number((amount * 0.05).toFixed(2));
          const totalAmountWithGST = Number((amount + gst).toFixed(2));
          const deliveryCharge = challans.reduce(
            (sum, challan) => sum + Number(challan.deliveryCharge || 0),
            0
          );
          const totalAmountWithDelivery = roundAmount(
            totalAmountWithGST + deliveryCharge
          );

          return {
            orderId: order.orderId,
            firmName: order.firmName,
            gstNumber: order.gstNumber,
            shippingAddress: order.shippingAddress,
            paymentStatus: order.paymentStatus,
            paymentMethod: order.paymentMethod,
            orderStatus: order.orderStatus,
            createdAt: order.createdAt,
            type: order.type,
            totalAmount: order.totalAmount,
            amount,
            gst,
            totalAmountWithGST,
            deliveryCharge,
            totalAmountWithDelivery,
            priceUpdated: order.priceUpdated,
            priceUpdateHistory: order.priceUpdateHistory.map((history) => ({
              product: history.product,
              oldPrice: history.oldPrice,
              newPrice: history.newPrice,
              updatedBy: history.updatedBy ? {
                id: history.updatedBy._id,
                name: history.updatedBy.name,
                role: history.updatedBy.role,
              } : null,
              updatedAt: history.updatedAt,
            })),
            products: order.products.map((item) => ({
              productId: item.product._id,
              name: item.product.name,
              type: item.product.type,
              quantity: item.boxes,
              price: item.price,
              originalPrice: item.product.originalPrice,
              discountedPrice: item.product.discountedPrice,
              isOfferValid: item.product.discountedPrice &&
                item.product.validFrom &&
                item.product.validTo &&
                new Date() >= new Date(item.product.validFrom) &&
                new Date() <= new Date(item.product.validTo),
            })),
            user: order.user ? {
              name: order.user.name,
              email: order.user.email,
              phoneNumber: order.user.phoneNumber,
              firmName: order.user.customerDetails?.firmName,
              userCode: order.user.customerDetails?.userCode,
            } : null,
          };
        })
      );

      res.json({
        orders: formattedOrders,
        totalOrders: formattedOrders.length,
        summary: {
          totalBottleOrders: groupedOrders["Bottle"].length,
          totalRawMaterialOrders: groupedOrders["Raw Material"].length,
          totalOrders: orders.length,
          totalPriceUpdatedOrders: orders.filter((order) => order.priceUpdated).length,
        },
      });
    } catch (error) {
      console.error("Error in getAllOrders:", error);
      res.status(500).json({ error: "Error fetching orders", details: error.message });
    }
  },

  updateOrderStatus: async (req, res) => {
    try {
      const { orderStatus, deliveryNote } = req.body;
      const order = await Order.findById(req.params.orderId);

      if (!order) return res.status(404).json({ error: "Order not found" });

      if (
        ![
          "processing",
          "confirmed",
          "shipped",
          "delivered",
          "cancelled",
        ].includes(orderStatus)
      ) {
        return res.status(400).json({ error: "Invalid order status" });
      }

      order.orderStatus = orderStatus;
      if (deliveryNote) {
        order.deliveryNote = {
          ...deliveryNote,
          createdAt: new Date(),
        };
      }

      await order.save();
      res.json({ order });
    } catch (error) {
      console.error("Error updating order status:", error);
      res.status(500).json({ error: "Error updating order status" });
    }
  },

  downloadOrderHistory: async (req, res) => {
    try {
      const orders = await Order.find({})
        .populate(
          "user",
          "name email phoneNumber customerDetails.firmName customerDetails.userCode"
        )
        .populate("products.product", "name type")
        .sort({ createdAt: -1 });

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Order History");

      worksheet.columns = [
        { header: "Order ID", key: "orderId", width: 20 },
        { header: "Customer Name", key: "userName", width: 20 },
        { header: "Firm Name", key: "firmName", width: 25 },
        { header: "User Code", key: "userCode", width: 15 },
        { header: "Email", key: "email", width: 15 },
        { header: "Phone Number", key: "phoneNumber", width: 15 },
        { header: "Type", key: "type", width: 15 },
        { header: "Products", key: "products", width: 40 },
        { header: "Total Amount", key: "totalAmount", width: 15 },
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
        { header: "GST Number", key: "gstNumber", width: 20 },
        { header: "Created At", key: "createdAt", width: 20 },
        { header: "Updated At", key: "updatedAt", width: 20 },
      ];

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).alignment = {
        vertical: "middle",
        horizontal: "center",
      };
      worksheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFDDDDDD" },
      };

      orders.forEach((order) => {
        const productsString = order.products
          .map(
            (p) => `${p.product.name} (Qty: ${p.quantity}, Price: ${p.price})`
          )
          .join("; ");

        worksheet.addRow({
          orderId: order.orderId,
          userName: order.user?.name || "N/A",
          firmName:
            order.firmName || order.user?.customerDetails?.firmName || "N/A",
          userCode: order.user?.customerDetails?.userCode || "N/A",
          phoneNumber: order.user?.phoneNumber || "N/A",
          email: order.user?.email || "N/A",
          type: order.type,
          products: productsString,
          totalAmount: order.totalAmount,
          deliveryCharge: order.deliveryCharge,
          totalAmountWithDelivery: order.totalAmountWithDelivery,
          paymentMethod: order.paymentMethod,
          paymentStatus: order.paymentStatus,
          orderStatus: order.orderStatus,
          shippingAddress: order.shippingAddress,
          gstNumber: order.gstNumber || "N/A",
          createdAt: order.createdAt.toLocaleString(),
          updatedAt: order.updatedAt.toLocaleString(),
        });
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="Order_History.xlsx"'
      );

      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error("Error generating order history Excel:", error);
      res
        .status(500)
        .json({ error: "Error generating order history Excel file" });
    }
  },

  getDashboardStats: async (req, res) => {
    try {
      const users = {
        total: await User.countDocuments({ role: "user" }),
        active: await User.countDocuments({ role: "user", isActive: true }),
        inactive: await User.countDocuments({ role: "user", isActive: false }),
      };

      const products = {
        total: await Product.countDocuments(),
        bottles: await Product.countDocuments({ type: "Bottle" }),
        rawMaterials: await Product.countDocuments({ type: "Raw Material" }),
      };

      const orders = {
        pending: await Order.countDocuments({ orderStatus: "pending" }),
        preview: await Order.countDocuments({ orderStatus: "preview" }),
        processing: await Order.countDocuments({ orderStatus: "processing" }),
        confirmed: await Order.countDocuments({ orderStatus: "confirmed" }),
        shipped: await Order.countDocuments({ orderStatus: "shipped" }),
        // delivered: await Order.countDocuments({ orderStatus: 'delivered' }),
        cancelled: await Order.countDocuments({ orderStatus: "cancelled" }),
      };

      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const ordersRequiringAttention = await Order.countDocuments({
        orderStatus: "pending",
        createdAt: { $lte: sixHoursAgo },
      });

      const recentOrderActivity = await Order.find({})
        .sort({ updatedAt: -1 })
        .limit(5)
        .select("orderId orderStatus statusHistory")
        .populate("statusHistory.updatedBy", "name role");

      const stats = {
        users,
        products,
        orders,
      };

      res.json({ stats });
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ error: "Error fetching dashboard stats" });
    }
  },

  checkUserStatus: async (req, res, next) => {
    try {
      const user = await User.findById(req.user._id);

      if (!user || !user.isActive) {
        return res.status(403).json({
          error:
            "Your account is currently inactive. Please contact admin for support.",
        });
      }

      next();
    } catch (error) {
      res.status(500).json({ error: "Error checking user status" });
    }
  },

  getAllMarketingActivities: async (req, res) => {
    try {
      const activities = await MarketingActivity.find({})
        .populate("marketingUser", "name email customerDetails.firmName")
        .sort({ createdAt: -1 });

      res.json({ activities });
    } catch (error) {
      console.error("Error fetching marketing activities:", error);
      res.status(500).json({ error: "Error fetching marketing activities" });
    }
  },

  reviewMarketingActivity: async (req, res) => {
    try {
      const activity = await MarketingActivity.findById(req.params.activityId);

      if (!activity) {
        return res.status(404).json({ error: "Activity not found" });
      }

      if (!activity.visitType || !activity.customerMobile) {
        return res.status(400).json({
          error:
            "Cannot review activity: missing required fields (visitType or customerMobile)",
        });
      }

      activity.status = "reviewed";
      activity.reviewedAt = new Date();
      activity.reviewedBy = req.user._id;

      await activity.save({ validateModifiedOnly: true });

      res.json({
        message: "Marketing activity reviewed successfully",
        activity,
      });
    } catch (error) {
      console.error("Error reviewing marketing activity:", error);
      if (error.name === "ValidationError") {
        return res.status(400).json({
          error: "Validation failed",
          details: error.errors,
        });
      }
      res.status(500).json({ error: "Error reviewing marketing activity" });
    }
  },

  downloadAllMarketingActivities: async (req, res) => {
    try {
      const activities = await MarketingActivity.find({})
        .populate("marketingUser", "name email customerDetails.firmName")
        .sort({ createdAt: -1 });

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Marketing Activities");

      worksheet.columns = [
        { header: "Activity ID", key: "_id", width: 25 },
        { header: "Marketing User", key: "marketingUserName", width: 20 },
        { header: "User Email", key: "marketingUserEmail", width: 25 },
        { header: "Firm Name", key: "firmName", width: 25 },
        { header: "Customer Name", key: "customerName", width: 20 },
        { header: "Customer Mobile", key: "customerMobile", width: 15 },
        { header: "Discussion", key: "discussion", width: 40 },
        { header: "Location", key: "location", width: 20 },
        { header: "Visit Type", key: "visitType", width: 15 },
        { header: "Inquiry Type", key: "inquiryType", width: 15 },
        { header: "Remarks", key: "remarks", width: 30 },
        { header: "Images", key: "images", width: 40 },
        { header: "Status", key: "status", width: 15 },
        { header: "Reviewed At", key: "reviewedAt", width: 20 },
        { header: "Reviewed By", key: "reviewedBy", width: 25 },
        { header: "Created At", key: "createdAt", width: 20 },
      ];

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).alignment = {
        vertical: "middle",
        horizontal: "center",
      };
      worksheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFDDDDDD" }, // Light gray background
      };

      activities.forEach((activity) => {
        worksheet.addRow({
          _id: activity._id.toString(),
          marketingUserName: activity.marketingUser?.name || "N/A",
          marketingUserEmail: activity.marketingUser?.email || "N/A",
          firmName: activity.marketingUser?.customerDetails?.firmName || "N/A",
          customerName: activity.customerName || "N/A",
          customerMobile: activity.customerMobile || "N/A",
          discussion: activity.discussion || "N/A",
          location: activity.location || "N/A",
          visitType: activity.visitType || "N/A",
          inquiryType: activity.inquiryType || "N/A",
          remarks: activity.remarks || "N/A",
          images:
            activity.images?.length > 0 ? activity.images.join("; ") : "None",
          status: activity.status || "pending",
          reviewedAt: activity.reviewedAt
            ? activity.reviewedAt.toLocaleString()
            : "N/A",
          reviewedBy: activity.reviewedBy
            ? activity.reviewedBy.toString()
            : "N/A",
          createdAt: activity.createdAt.toLocaleString(),
        });
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="Marketing_Activities.xlsx"'
      );

      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error("Error generating marketing activities Excel:", error);
      res
        .status(500)
        .json({ error: "Error generating marketing activities Excel file" });
    }
  },

  getAllAttendance: async (req, res) => {
    try {
      const { startDate, endDate, panel } = req.query;

      let query = {};

      if (panel) {
        query.panel = panel;
      }

      if (startDate && endDate) {
        query.selectedDate = {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        };
      }

      const attendance = await Attendance.find(query)
        .populate({
          path: "user",
          select: "name email customerDetails.firmName panel",
        })
        .sort({ selectedDate: -1 });

      const summary = {
        totalRecords: attendance.length,
        totalPresent: attendance.filter(
          (a) => a.status === "present" || a.status === "checked-in"
        ).length,
        totalAbsent: attendance.filter((a) => a.status === "absent").length,
        totalHours: attendance.reduce(
          (sum, record) => sum + (record.totalHours || 0),
          0
        ),
        byPanel: attendance.reduce((acc, record) => {
          acc[record.panel] = (acc[record.panel] || 0) + 1;
          return acc;
        }, {}),
      };

      res.json({
        attendance,
        summary,
      });
    } catch (error) {
      console.error("Error fetching attendance:", error);
      res
        .status(500)
        .json({ error: "Error fetching attendance", details: error.message });
    }
  },

  getAttendanceSummary: async (req, res) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const summary = {
        todayCheckIns: await Attendance.countDocuments({
          date: { $gte: today },
          status: "checked-in",
        }),
        todayCheckOuts: await Attendance.countDocuments({
          date: { $gte: today },
          status: "checked-out",
        }),
        activeUsers: await Attendance.distinct("user", {
          date: { $gte: today },
          status: "checked-in",
        }),
        panelBreakdown: await Attendance.aggregate([
          {
            $match: {
              date: { $gte: today },
            },
          },
          {
            $group: {
              _id: "$panel",
              count: { $sum: 1 },
            },
          },
        ]),

        todayCheckInImages: await Attendance.find({
          date: { $gte: today },
          checkInImage: { $ne: null },
        })
          .select("user checkInImage date panel")
          .populate("user", "name"),
      };

      res.json({ summary });
    } catch (error) {
      console.error("Error fetching attendance summary:", error);
      res
        .status(500)
        .json({
          error: "Error fetching attendance summary",
          details: error.message,
        });
    }
  },

  getCheckInImages: async (req, res) => {
    try {
      const { startDate, endDate, panel, userId } = req.query;

      let query = {
        checkInImage: { $ne: null },
      };

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

      const checkInImages = await Attendance.find(query)
        .select("user checkInImage date panel")
        .populate("user", "name email");

      res.json({
        checkInImages,
        total: checkInImages.length,
      });
    } catch (error) {
      console.error("Error fetching check-in images:", error);
      res
        .status(500)
        .json({
          error: "Error fetching check-in images",
          details: error.message,
        });
    }
  },

  getAdminProfile: async (req, res) => {
    try {
      const admin = await User.findById(req.user._id)
        .select("-password -__v")
        .lean();

      if (!admin) {
        return res.status(404).json({ error: "Admin profile not found" });
      }

      if (admin.role !== "admin") {
        return res
          .status(403)
          .json({ error: "Access denied. Not an admin user." });
      }

      res.json({
        profile: {
          _id: admin._id,
          name: admin.name,
          email: admin.email,
          phoneNumber: admin.phoneNumber,
          role: admin.role,
          createdAt: admin.createdAt,
        },
      });
    } catch (error) {
      console.error("Error fetching admin profile:", error);
      res.status(500).json({ error: "Error fetching admin profile" });
    }
  },

  uploadBanner: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Banner image is required" });
      }

      const bannerCount = await Banner.countDocuments({ isActive: true });
      if (bannerCount >= 3) {
        return res
          .status(400)
          .json({
            error:
              "Maximum 3 banners allowed. Delete or update existing banners.",
          });
      }

      const b64 = req.file.buffer.toString("base64");
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;
      const result = await cloudinary.uploader.upload(dataURI, {
        folder: "banners",
        resource_type: "image",
      });

      const existingOrders = await Banner.find({ isActive: true }).select(
        "order"
      );
      const usedOrders = existingOrders.map((b) => b.order);
      const availableOrder = [1, 2, 3].find((o) => !usedOrders.includes(o));

      const banner = new Banner({
        image: result.secure_url,
        order: availableOrder,
      });

      await banner.save();
      res.status(201).json({
        message: "Banner uploaded successfully",
        banner,
      });
    } catch (error) {
      console.error("Error uploading banner:", error);
      res.status(500).json({ error: "Error uploading banner" });
    }
  },

  updateBanner: async (req, res) => {
    try {
      const { bannerId } = req.params;

      const banner = await Banner.findById(bannerId);
      if (!banner) {
        return res.status(404).json({ error: "Banner not found" });
      }

      const updates = {};
      if (req.body.order) {
        const newOrder = Number(req.body.order);
        if (![1, 2, 3].includes(newOrder)) {
          return res.status(400).json({ error: "Order must be 1, 2, or 3" });
        }

        const conflictingBanner = await Banner.findOne({
          order: newOrder,
          _id: { $ne: bannerId },
          isActive: true,
        });
        if (conflictingBanner) {
          return res
            .status(400)
            .json({
              error: `Order ${newOrder} is already assigned to another banner`,
            });
        }
        updates.order = newOrder;
      }

      if (req.file) {
        const b64 = req.file.buffer.toString("base64");
        const dataURI = `data:${req.file.mimetype};base64,${b64}`;
        const result = await cloudinary.uploader.upload(dataURI, {
          folder: "banners",
          resource_type: "image",
        });
        updates.image = result.secure_url;

        if (banner.image) {
          const publicId = banner.image.split("/").pop().split(".")[0];
          await cloudinary.uploader.destroy(`banners/${publicId}`);
        }
      }

      const updatedBanner = await Banner.findByIdAndUpdate(bannerId, updates, {
        new: true,
      });

      res.json({
        message: "Banner updated successfully",
        banner: updatedBanner,
      });
    } catch (error) {
      console.error("Error updating banner:", error);
      res.status(500).json({ error: "Error updating banner" });
    }
  },

  deleteBanner: async (req, res) => {
    try {
      const { bannerId } = req.params;

      const banner = await Banner.findById(bannerId);
      if (!banner) {
        return res.status(404).json({ error: "Banner not found" });
      }

      if (banner.image) {
        const publicId = banner.image.split("/").pop().split(".")[0];
        await cloudinary.uploader.destroy(`banners/${publicId}`);
      }

      await Banner.findByIdAndDelete(bannerId);

      res.json({ message: "Banner deleted successfully" });
    } catch (error) {
      console.error("Error deleting banner:", error);
      res.status(500).json({ error: "Error deleting banner" });
    }
  },

  getAllBanners: async (req, res) => {
    try {
      const banners = await Banner.find({ isActive: true }).sort({ order: 1 });
      res.json({ banners });
    } catch (error) {
      console.error("Error fetching banners:", error);
      res.status(500).json({ error: "Error fetching banners" });
    }
  },

  addCategory: async (req, res) => {
    try {
      const { type, name, code } = req.body;

      if (!type || !name || !code) {
        return res.status(400).json({ success: false, message: "Type, name and code are required" });
      }

      const exists = await Category.findOne({ type, code });
      if (exists) {
        return res.status(400).json({ success: false, message: "Category with this code already exists" });
      }

      const category = new Category({ type, name, code });
      await category.save();

      res.status(201).json({ success: true, data: category });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  addFormula: async (req, res) => {
    try {
      const { name, formula, unit, description } = req.body;

      if (!name || !formula || !unit) {
        return res.status(400).json({ success: false, message: "Name, formula and unit are required" });
      }

      const exists = await Formula.findOne({ name });
      if (exists) {
        return res.status(400).json({ success: false, message: "Formula with this name already exists" });
      }

      const formulaDoc = new Formula({ name, formula, unit, description });
      await formulaDoc.save();

      res.status(201).json({ success: true, data: formulaDoc });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  getCategories: async (req, res) => {
    try {
      const { type } = req.query;

      let filter = { isActive: true };
      if (type) filter.type = type;

      const categories = await Category.find(filter).sort({ name: 1 });
      res.status(200).json({ success: true, data: categories });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  getFormulas: async (req, res) => {
    try {
      const formulas = await Formula.find({ isActive: true }).sort({ name: 1 });
      res.status(200).json({ success: true, data: formulas });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },


  exportStockReport: async (req, res) => {
    try {
      const { format = 'csv' } = req.query;

      // Get stock data
      const materials = await RawMaterial.find({ isActive: true })
        .select('itemName itemCode subcategory unit supplier minStockLevel currentStock')
        .sort({ itemName: 1 });

      const stockData = materials.map(material => ({
        'Item Name': material.itemName,
        'Item Code': material.itemCode,
        'Category': material.subcategory || 'N/A',
        'Unit': material.unit,
        'Supplier': material.supplier || 'N/A',
        'Min Stock Level': material.minStockLevel,
        'Current Stock': material.currentStock,
        'Stock Status': material.currentStock <= 0 ? 'OUT_OF_STOCK' :
          material.currentStock <= material.minStockLevel ? 'LOW_STOCK' : 'NORMAL',
        'Needs Reorder': material.currentStock <= material.minStockLevel ? 'YES' : 'NO'
      }));

      if (format === 'excel') {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Stock Report');

        // Add headers
        worksheet.columns = [
          { header: 'Item Name', key: 'itemName', width: 25 },
          { header: 'Item Code', key: 'itemCode', width: 15 },
          { header: 'Category', key: 'category', width: 20 },
          { header: 'Unit', key: 'unit', width: 10 },
          { header: 'Supplier', key: 'supplier', width: 20 },
          { header: 'Min Stock Level', key: 'minStockLevel', width: 15 },
          { header: 'Current Stock', key: 'currentStock', width: 15 },
          { header: 'Stock Status', key: 'stockStatus', width: 15 },
          { header: 'Needs Reorder', key: 'needsReorder', width: 15 }
        ];

        // Style header row
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
        worksheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: '4472C4' }
        };
        worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

        // Add data rows
        stockData.forEach(row => {
          const newRow = worksheet.addRow(row);

          // Apply conditional formatting
          if (row['Stock Status'] === 'LOW_STOCK') {
            newRow.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE699' }
            };
          } else if (row['Stock Status'] === 'OUT_OF_STOCK') {
            newRow.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFC7CE' }
            };
          }
        });

        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="stock-report-${new Date().toISOString().split('T')[0]}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();

      } else {
        // CSV export
        const fields = [
          'Item Name', 'Item Code', 'Category', 'Unit', 'Supplier',
          'Min Stock Level', 'Current Stock', 'Stock Status', 'Needs Reorder'
        ];
        const parser = new Parser({ fields });
        const csv = parser.parse(stockData);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="stock-report-${new Date().toISOString().split('T')[0]}.csv"`);
        res.status(200).send(csv);
      }
    } catch (error) {
      console.error('Error exporting stock report:', error);
      res.status(500).json({
        success: false,
        message: 'Error exporting stock report',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  // ---------------- PRODUCTION REPORT ----------------
  exportProductionReport: async (req, res) => {
    try {
      const { startDate, endDate, type = 'all', format = 'csv' } = req.query;

      let filter = {};

      if (startDate && endDate) {
        filter.productionDate = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      }

      // Get production data from all production types
      const [preformProductions, capProductions, bottleProductions, productionOutcomes] = await Promise.all([
        PreformProduction.find(filter)
          .populate("rawMaterials.material", "itemName itemCode unit")
          .populate("recordedBy", "name")
          .sort({ productionDate: -1 }),

        CapProduction.find(filter)
          .populate("rawMaterials.material", "itemName itemCode unit")
          .populate("recordedBy", "name")
          .sort({ productionDate: -1 }),

        BottleProduction.find(filter)
          .populate("details.preformMaterial", "itemName itemCode unit")
          .populate("recordedBy", "name")
          .sort({ productionDate: -1 }),

        ProductionOutcome.find(filter)
          .populate("rawMaterial", "itemName itemCode unit")
          .populate("outcomes.outcomeItem", "itemName itemCode type")
          .populate("recordedBy", "name")
          .sort({ productionDate: -1 })
      ]);

      // Combine all production data
      const productionData = [];

      // Process Preform Productions
      preformProductions.forEach(prod => {
        const rawMaterialsUsed = prod.rawMaterials.map(rm =>
          `${rm.material?.itemName || 'N/A'} (${rm.quantityUsed} ${rm.material?.unit || 'Kg'})`
        ).join(', ');

        productionData.push({
          productionType: 'Preform',
          date: prod.productionDate.toISOString().split('T')[0],
          productType: prod.outcomeType,
          quantityProduced: `${prod.quantityProduced} Kg`,
          rawMaterialsUsed: rawMaterialsUsed,
          wastageKg: prod.wastage || 0,
          efficiencyPercent: prod.quantityProduced && prod.rawMaterials.length > 0 ?
            ((prod.quantityProduced / (prod.quantityProduced + prod.wastage)) * 100).toFixed(2) + '%' : 'N/A',
          recordedBy: prod.recordedBy?.name || 'N/A',
          remarks: prod.remarks || 'N/A'
        });
      });

      // Process Cap Productions
      capProductions.forEach(prod => {
        const rawMaterialsUsed = prod.rawMaterials.map(rm =>
          `${rm.material?.itemName || 'N/A'} (${rm.quantityUsed} ${rm.material?.unit || 'Kg'})`
        ).join(', ');

        productionData.push({
          productionType: 'Cap',
          date: prod.productionDate.toISOString().split('T')[0],
          productType: prod.capType,
          quantityProduced: `${prod.quantityProduced} Nos`,
          rawMaterialsUsed: rawMaterialsUsed,
          wastageKg: prod.wastage || 0,
          packagingUsed: `Boxes: ${prod.packagingUsed?.boxes || 0}, Bags: ${prod.packagingUsed?.bags || 0}`,
          efficiencyPercent: prod.quantityProduced && prod.rawMaterials.length > 0 ?
            ((prod.quantityProduced / (prod.quantityProduced + prod.wastage)) * 100).toFixed(2) + '%' : 'N/A',
          recordedBy: prod.recordedBy?.name || 'N/A',
          remarks: prod.remarks || 'N/A'
        });
      });

      // Process Bottle Productions
      bottleProductions.forEach(prod => {
        productionData.push({
          productionType: 'Bottle',
          date: prod.productionDate.toISOString().split('T')[0],
          productType: prod.bottleCategory,
          preformType: prod.preformType,
          quantityProduced: `${prod.details.totalBottles} Bottles`,
          boxesProduced: prod.boxesProduced,
          bottlesPerBox: prod.bottlesPerBox,
          materialsUsed: `Preform: ${prod.details.preformUsed || 0}, Labels: ${prod.details.labelsUsed || 0}, Caps: ${prod.details.capsUsed || 0}, Shrink Roll: ${prod.details.shrinkRollUsed || 0}gm`,
          recordedBy: prod.recordedBy?.name || 'N/A',
          remarks: prod.remarks || 'N/A'
        });
      });

      // Process General Production Outcomes
      productionOutcomes.forEach(prod => {
        const outcomes = prod.outcomes.map(outcome =>
          `${outcome.outcomeItem?.itemName || 'N/A'} (${outcome.quantityCreatedKg}kg)`
        ).join(', ');

        productionData.push({
          productionType: 'General',
          date: prod.productionDate.toISOString().split('T')[0],
          rawMaterial: prod.rawMaterial?.itemName || 'N/A',
          materialUsedKg: prod.usedRawMaterialKg,
          outcomesProduced: outcomes,
          wastageKg: prod.wastageKg,
          efficiencyPercent: prod.usedRawMaterialKg > 0 ?
            ((prod.usedRawMaterialKg - prod.wastageKg) / prod.usedRawMaterialKg * 100).toFixed(2) + '%' : 'N/A',
          recordedBy: prod.recordedBy?.name || 'N/A',
          remarks: prod.remarks || 'N/A'
        });
      });

      // Sort by date (newest first)
      productionData.sort((a, b) => new Date(b.date) - new Date(a.date));

      if (format === 'excel') {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Production Report');

        // Define columns
        worksheet.columns = [
          { header: 'Production Type', key: 'productionType', width: 15 },
          { header: 'Date', key: 'date', width: 12 },
          { header: 'Product Type', key: 'productType', width: 20 },
          { header: 'Preform Type', key: 'preformType', width: 15 },
          { header: 'Quantity Produced', key: 'quantityProduced', width: 20 },
          { header: 'Boxes Produced', key: 'boxesProduced', width: 15 },
          { header: 'Bottles Per Box', key: 'bottlesPerBox', width: 15 },
          { header: 'Raw Materials Used', key: 'rawMaterialsUsed', width: 30 },
          { header: 'Materials Used', key: 'materialsUsed', width: 40 },
          { header: 'Material Used (Kg)', key: 'materialUsedKg', width: 18 },
          { header: 'Outcomes Produced', key: 'outcomesProduced', width: 30 },
          { header: 'Wastage (Kg)', key: 'wastageKg', width: 15 },
          { header: 'Packaging Used', key: 'packagingUsed', width: 20 },
          { header: 'Efficiency %', key: 'efficiencyPercent', width: 15 },
          { header: 'Recorded By', key: 'recordedBy', width: 20 },
          { header: 'Remarks', key: 'remarks', width: 25 }
        ];

        // Style header row
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
        worksheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: '4472C4' }
        };
        worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

        // Add data
        productionData.forEach(row => {
          worksheet.addRow(row);
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="production-report-${new Date().toISOString().split('T')[0]}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();

      } else {
        // CSV export
        const fields = [
          'productionType', 'date', 'productType', 'preformType', 'quantityProduced',
          'boxesProduced', 'bottlesPerBox', 'rawMaterialsUsed', 'materialsUsed',
          'materialUsedKg', 'outcomesProduced', 'wastageKg', 'packagingUsed',
          'efficiencyPercent', 'recordedBy', 'remarks'
        ];

        const parser = new Parser({ fields });
        const csv = parser.parse(productionData);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="production-report-${new Date().toISOString().split('T')[0]}.csv"`);
        res.status(200).send(csv);
      }

    } catch (error) {
      console.error("Error exporting production report:", error);
      res.status(500).json({
        success: false,
        message: "Error exporting production report",
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  // ---------------- WASTAGE REPORT ----------------
  exportWastageReport: async (req, res) => {
    try {
      const { startDate, endDate, source, wastageType, format = 'csv' } = req.query;

      let filter = {};

      if (startDate && endDate) {
        filter.date = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      }

      if (source) filter.source = source;
      if (wastageType) filter.wastageType = wastageType;

      const wastage = await Wastage.find(filter)
        .populate("recordedBy", "name")
        .sort({ date: -1 });

      const wastageData = wastage.map(w => {
        const reusePercentage = w.quantityGenerated > 0 ?
          ((w.quantityReused / w.quantityGenerated) * 100) : 0;

        const scrapPercentage = w.quantityGenerated > 0 ?
          ((w.quantityScrapped / w.quantityGenerated) * 100) : 0;

        return {
          date: w.date.toISOString().split('T')[0],
          wastageType: w.wastageType,
          source: w.source,
          quantityGeneratedKg: w.quantityGenerated,
          quantityReusedKg: w.quantityReused,
          quantityScrappedKg: w.quantityScrapped,
          reusePercent: reusePercentage.toFixed(2) + '%',
          scrapPercent: scrapPercentage.toFixed(2) + '%',
          status: reusePercentage >= 50 ? 'High Reuse' :
            reusePercentage >= 20 ? 'Medium Reuse' : 'Low Reuse',
          reuseReference: w.reuseReference || 'N/A',
          recordedBy: w.recordedBy?.name || 'N/A',
          remarks: w.remarks || 'N/A'
        };
      });

      // Calculate summary statistics
      const totalGenerated = wastageData.reduce((sum, w) => sum + w.quantityGeneratedKg, 0);
      const totalReused = wastageData.reduce((sum, w) => sum + w.quantityReusedKg, 0);
      const totalScrapped = wastageData.reduce((sum, w) => sum + w.quantityScrappedKg, 0);
      const overallReuseRate = totalGenerated > 0 ? (totalReused / totalGenerated * 100) : 0;

      if (format === 'excel') {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Wastage Report');

        // Add summary row
        worksheet.mergeCells('A1:E1');
        const summaryRow = worksheet.getCell('A1');
        summaryRow.value = 'Wastage Summary';
        summaryRow.font = { bold: true, size: 14 };
        summaryRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'F2F2F2' }
        };
        summaryRow.alignment = { horizontal: 'center' };

        worksheet.addRow([`Total Generated: ${totalGenerated} Kg`]);
        worksheet.addRow([`Total Reused: ${totalReused} Kg`]);
        worksheet.addRow([`Total Scrapped: ${totalScrapped} Kg`]);
        worksheet.addRow([`Overall Reuse Rate: ${overallReuseRate.toFixed(2)}%`]);
        worksheet.addRow([]); // Empty row for spacing

        // Define columns for data
        const dataStartRow = 7;
        worksheet.columns = [
          { header: 'Date', key: 'date', width: 12 },
          { header: 'Wastage Type', key: 'wastageType', width: 20 },
          { header: 'Source', key: 'source', width: 15 },
          { header: 'Quantity Generated (Kg)', key: 'quantityGeneratedKg', width: 20 },
          { header: 'Quantity Reused (Kg)', key: 'quantityReusedKg', width: 20 },
          { header: 'Quantity Scrapped (Kg)', key: 'quantityScrappedKg', width: 20 },
          { header: 'Reuse %', key: 'reusePercent', width: 15 },
          { header: 'Scrap %', key: 'scrapPercent', width: 15 },
          { header: 'Status', key: 'status', width: 15 },
          { header: 'Reuse Reference', key: 'reuseReference', width: 20 },
          { header: 'Recorded By', key: 'recordedBy', width: 25 },
          { header: 'Remarks', key: 'remarks', width: 30 }
        ];

        // Style header row
        const headerRow = worksheet.getRow(dataStartRow);
        headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
        headerRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: '4472C4' }
        };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

        // Add data with conditional formatting
        wastageData.forEach((row, index) => {
          const dataRow = worksheet.addRow(row);
          const rowNumber = dataStartRow + 1 + index;

          // Apply conditional formatting based on reuse status
          if (row.status === 'High Reuse') {
            dataRow.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'C6EFCE' }
            };
          } else if (row.status === 'Medium Reuse') {
            dataRow.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFEB9C' }
            };
          } else if (row.status === 'Low Reuse') {
            dataRow.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFC7CE' }
            };
          }
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="wastage-report-${new Date().toISOString().split('T')[0]}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();

      } else {
        // CSV export
        const fields = [
          'date', 'wastageType', 'source', 'quantityGeneratedKg',
          'quantityReusedKg', 'quantityScrappedKg', 'reusePercent',
          'scrapPercent', 'status', 'reuseReference', 'recordedBy', 'remarks'
        ];

        const parser = new Parser({ fields });
        const csv = parser.parse(wastageData);

        // Add summary to CSV as comments
        const summary = [
          '# WASTAGE SUMMARY',
          `# Total Generated: ${totalGenerated} Kg`,
          `# Total Reused: ${totalReused} Kg`,
          `# Total Scrapped: ${totalScrapped} Kg`,
          `# Overall Reuse Rate: ${overallReuseRate.toFixed(2)}%`,
          ''
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="wastage-report-${new Date().toISOString().split('T')[0]}.csv"`);
        res.status(200).send(summary + csv);
      }

    } catch (error) {
      console.error("Error exporting wastage report:", error);
      res.status(500).json({
        success: false,
        message: "Error exporting wastage report",
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },


  getRawMaterialStockSummary: async (req, res) => {
    try {
      // Get all active raw materials
      const materials = await RawMaterial.find({ isActive: true })
        .select("itemName itemCode unit minStockLevel currentStock")
        .sort({ itemName: 1 });

      // Calculate total inward quantity for each material
      const totalInward = await RawMaterialEntry.aggregate([
        {
          $group: {
            _id: "$rawMaterial",
            totalInwardKg: { $sum: "$quantityKg" },
            entryCount: { $sum: 1 },
            lastEntryDate: { $max: "$entryDate" }
          }
        }
      ]);

      // Calculate total used quantity for each material from production outcomes
      const totalUsed = await ProductionOutcome.aggregate([
        {
          $group: {
            _id: "$rawMaterial",
            totalUsedKg: { $sum: "$usedRawMaterialKg" },
            productionCount: { $sum: 1 }
          }
        }
      ]);

      // Calculate total wastage by material type (from wastage records)
      const totalWastageByMaterial = await Wastage.aggregate([
        {
          $lookup: {
            from: "productionoutcomes",
            localField: "reuseReference",
            foreignField: "_id",
            as: "productionData"
          }
        },
        {
          $unwind: {
            path: "$productionData",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $group: {
            _id: "$productionData.rawMaterial",
            totalWastageGenerated: { $sum: "$quantityGenerated" },
            totalWastageReused: { $sum: "$quantityReused" },
            totalWastageScrapped: { $sum: "$quantityScrapped" }
          }
        }
      ]);

      // Calculate overall totals
      const overallInward = await RawMaterialEntry.aggregate([
        {
          $group: {
            _id: null,
            totalInward: { $sum: "$quantityKg" },
            totalEntries: { $sum: 1 }
          }
        }
      ]);

      const overallUsed = await ProductionOutcome.aggregate([
        {
          $group: {
            _id: null,
            totalUsed: { $sum: "$usedRawMaterialKg" },
            totalProductions: { $sum: 1 }
          }
        }
      ]);

      const overallWastage = await Wastage.aggregate([
        {
          $group: {
            _id: null,
            totalWastageGenerated: { $sum: "$quantityGenerated" },
            totalWastageReused: { $sum: "$quantityReused" },
            totalWastageScrapped: { $sum: "$quantityScrapped" }
          }
        }
      ]);

      const totalProduced = await ProductionOutcome.aggregate([
        { $unwind: "$outcomes" },
        {
          $group: {
            _id: null,
            totalProducedKg: { $sum: "$outcomes.quantityCreatedKg" },
            outcomeTypes: { $addToSet: "$outcomes.outcomeItem" }
          }
        }
      ]);

      // Calculate direct usage totals
      const directUsage = await DirectUsage.aggregate([
        {
          $group: {
            _id: "$material",
            totalDirectUsed: { $sum: "$quantity" },
            usageCount: { $sum: 1 }
          }
        }
      ]);

      // Build material summary
      const summary = materials.map(mat => {
        const inward = totalInward.find(t => t._id?.toString() === mat._id.toString());
        const used = totalUsed.find(t => t._id?.toString() === mat._id.toString());
        const wastage = totalWastageByMaterial.find(t => t._id?.toString() === mat._id.toString());
        const directUsed = directUsage.find(t => t._id?.toString() === mat._id.toString());

        const totalInwardKg = inward?.totalInwardKg || 0;
        const totalUsedKg = used?.totalUsedKg || 0;
        const totalDirectUsedKg = directUsed?.totalDirectUsed || 0;
        const totalConsumedKg = totalUsedKg + totalDirectUsedKg;

        const availableKg = totalInwardKg - totalConsumedKg;
        const usageRate = totalInwardKg > 0 ? (totalConsumedKg / totalInwardKg) * 100 : 0;

        // Calculate wastage percentage (wastage generated vs material used)
        const wastageGenerated = wastage?.totalWastageGenerated || 0;
        const wastagePercent = totalUsedKg > 0 ? (wastageGenerated / totalUsedKg) * 100 : 0;

        // Stock status
        let stockStatus = "NORMAL";
        if (availableKg <= 0) {
          stockStatus = "OUT_OF_STOCK";
        } else if (availableKg <= mat.minStockLevel) {
          stockStatus = "LOW_STOCK";
        } else if (availableKg > mat.minStockLevel * 3) {
          stockStatus = "HIGH_STOCK";
        }

        return {
          rawMaterial: {
            _id: mat._id,
            itemName: mat.itemName,
            itemCode: mat.itemCode,
            unit: mat.unit,
            minStockLevel: mat.minStockLevel
          },
          totalInwardKg,
          totalUsedKg,
          totalDirectUsedKg,
          totalConsumedKg,
          availableKg: Math.max(0, availableKg),
          usageRate: parseFloat(usageRate.toFixed(2)),
          wastagePercent: parseFloat(wastagePercent.toFixed(2)),
          wastageGenerated,
          wastageReused: wastage?.totalWastageReused || 0,
          wastageScrapped: wastage?.totalWastageScrapped || 0,
          stockStatus,
          entryCount: inward?.entryCount || 0,
          productionCount: used?.productionCount || 0,
          lastEntryDate: inward?.lastEntryDate || null,
          needsReorder: availableKg <= mat.minStockLevel
        };
      });

      // Calculate overall statistics
      const totalAvailableKg = summary.reduce((sum, item) => sum + item.availableKg, 0);
      const totalInwardOverall = overallInward[0]?.totalInward || 0;
      const totalUsedOverall = overallUsed[0]?.totalUsed || 0;
      const totalWastageOverall = overallWastage[0] || {};
      const totalProducedOverall = totalProduced[0] || {};

      const overallEfficiency = totalUsedOverall > 0 ?
        ((totalProducedOverall.totalProducedKg || 0) / totalUsedOverall) * 100 : 0;

      const overall = {
        // Stock Overview
        totalMaterials: materials.length,
        totalInwardKg: totalInwardOverall,
        totalUsedKg: totalUsedOverall,
        totalAvailableKg,

        // Production Metrics
        totalProducedKg: totalProducedOverall.totalProducedKg || 0,
        totalProductions: overallUsed[0]?.totalProductions || 0,
        totalEntries: overallInward[0]?.totalEntries || 0,

        // Wastage Metrics
        totalWastageGenerated: totalWastageOverall.totalWastageGenerated || 0,
        totalWastageReused: totalWastageOverall.totalWastageReused || 0,
        totalWastageScrapped: totalWastageOverall.totalWastageScrapped || 0,
        wastageReuseRate: totalWastageOverall.totalWastageGenerated > 0 ?
          (totalWastageOverall.totalWastageReused / totalWastageOverall.totalWastageGenerated) * 100 : 0,

        // Efficiency Metrics
        overallEfficiency: parseFloat(overallEfficiency.toFixed(2)),
        materialUtilizationRate: totalInwardOverall > 0 ?
          ((totalUsedOverall + totalWastageOverall.totalWastageGenerated) / totalInwardOverall) * 100 : 0,

        // Stock Alerts
        lowStockItems: summary.filter(item => item.stockStatus === "LOW_STOCK").length,
        outOfStockItems: summary.filter(item => item.stockStatus === "OUT_OF_STOCK").length,
        needsReorderItems: summary.filter(item => item.needsReorder).length
      };

      // Add trend analysis (last 30 days vs previous 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

      const recentInward = await RawMaterialEntry.aggregate([
        {
          $match: {
            entryDate: { $gte: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: null,
            recentInward: { $sum: "$quantityKg" }
          }
        }
      ]);

      const previousInward = await RawMaterialEntry.aggregate([
        {
          $match: {
            entryDate: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: null,
            previousInward: { $sum: "$quantityKg" }
          }
        }
      ]);

      const inwardTrend = previousInward[0]?.previousInward > 0 ?
        ((recentInward[0]?.recentInward || 0) - previousInward[0].previousInward) / previousInward[0].previousInward * 100 : 0;

      overall.inwardTrend = parseFloat(inwardTrend.toFixed(2));

      res.status(200).json({
        success: true,
        data: {
          summary,
          overall,
          timestamp: new Date().toISOString(),
          generatedBy: req.user.name || req.user.email
        }
      });

    } catch (error) {
      console.error("Error in getRawMaterialStockSummary:", error);
      res.status(500).json({
        success: false,
        message: "Error generating raw material stock summary",
        error: error.message
      });
    }
  },

  getPaymentHistory: async (req, res) => {
    try {
      const { fromDate, toDate, paymentMode = "all" } = req.query;

      let matchStage = {};

      // 🔹 Date filter
      if (fromDate && toDate) {
        matchStage["paymentHistory.submissionDate"] = {
          $gte: new Date(fromDate),
          $lte: new Date(toDate),
        };
      }

      // 🔹 Payment mode filter
      if (paymentMode !== "all") {
        matchStage["paymentHistory.paymentMode"] = paymentMode;
      }

      const payments = await Payment.aggregate([
        { $unwind: "$paymentHistory" },

        { $match: matchStage },

        {
          $lookup: {
            from: "orders",
            localField: "orderDetails",
            foreignField: "_id",
            as: "order",
          },
        },
        { $unwind: "$order" },

        {
          $lookup: {
            from: "users",
            localField: "user",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: "$user" },

        {
          $project: {
            paymentId: "$_id",
            orderId: "$order._id",

            firmName: "$user.customerDetails.firmName",
            userCode: "$user.customerDetails.userCode",
            customerName: "$user.name",
            phoneNumber: "$user.phoneNumber",

            totalAmount: "$amount",
            paidAmount: "$paidAmount",

            remainingAmount: {
              $subtract: ["$amount", "$paidAmount"],
            },

            paymentMode: "$paymentHistory.paymentMode",

            // ✅ BANK NAME LOGIC
            bankName: {
              $cond: [
                { $eq: ["$paymentHistory.paymentMode", "online"] },
                { $ifNull: ["$paymentHistory.bankName", "N/A"] },
                "N/A",
              ],
            },

            submittedAmount: "$paymentHistory.submittedAmount",
            verifiedAmount: "$paymentHistory.verifiedAmount",
            paymentStatus: "$paymentHistory.status",
            paymentDate: "$paymentHistory.submissionDate",

            orderStatus: "$order.orderStatus",
            paymentMethod: "$order.paymentMethod",
          },
        },

        { $sort: { paymentDate: -1 } },
      ]);

      // 🔹 TOTAL CALCULATIONS
      const totalSubmittedAmount = payments.reduce(
        (sum, p) => sum + (p.submittedAmount || 0),
        0
      );

      const totalVerifiedAmount = payments.reduce(
        (sum, p) => sum + (p.verifiedAmount || 0),
        0
      );

      const totalCash = payments
        .filter((p) => p.paymentMode === "cash")
        .reduce((sum, p) => sum + p.submittedAmount, 0);

      const totalOnline = payments
        .filter((p) => p.paymentMode === "online")
        .reduce((sum, p) => sum + p.submittedAmount, 0);

      // ✅ BANK-WISE TOTALS
      const totalHDFC = payments
        .filter((p) => p.bankName === "HDFC")
        .reduce((sum, p) => sum + p.submittedAmount, 0);

      const totalIDFC = payments
        .filter((p) => p.bankName === "IDFC")
        .reduce((sum, p) => sum + p.submittedAmount, 0);

      res.json({
        totalRecords: payments.length,

        summary: {
          totalSubmittedAmount,
          totalVerifiedAmount,
          totalCash,
          totalOnline,
          totalHDFC,
          totalIDFC,
        },

        payments,
      });
    } catch (error) {
      console.error("Error fetching payment history:", error);
      res.status(500).json({
        error: "Error fetching payment history",
        details: error.message,
      });
    }
  },
  
  getFilteredOrders: async (req, res) => {
    try {
      let { startDate, endDate, status } = req.query;

      const filter = {};

      if (startDate || endDate) {
        filter.createdAt = {};

        if (startDate) {
          filter.createdAt.$gte = new Date(startDate);
        }

        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          filter.createdAt.$lte = end;
        }
      }

      if (status) {
        filter.orderStatus = Array.isArray(status)
          ? { $in: status }
          : status;
      }

      const orders = await Order.find(filter)
        .populate("user", "name phoneNumber")
        .populate("products.product", "name")
        .populate("createdByReception", "name")
        .populate("rejectedBy", "name")
        .sort({ createdAt: -1 });

      const formatted = await Promise.all(
        orders.map(async (o) => {
          const [payment, challans] = await Promise.all([
            Payment.findOne({ orderDetails: o._id }).lean(),
            Challan.find({ originalOrder: o._id }).lean(),
          ]);

          const amount = Number(o.totalAmount || 0);
          const gst = Number((amount * 0.05).toFixed(2));
          const totalAmountWithGST = Number((amount + gst).toFixed(2));
          const deliveryCharge = (challans || []).reduce(
            (sum, challan) => sum + Number(challan.deliveryCharge || 0),
            0
          );
          const totalAmountWithDelivery = roundAmount(
            totalAmountWithGST + deliveryCharge
          );

          return {
            orderId: o.orderId,

            customerName: o.user?.name,
            phone: o.user?.phoneNumber,
            firmName: o.firmName,
            gstNumber: o.gstNumber,

            totalAmount: o.totalAmount,
            amount,
            gst,
            totalAmountWithGST,
            deliveryCharge,
            totalAmountWithDelivery,

            paymentMethod: o.paymentMethod,
            paymentStatus: o.paymentStatus,

            orderStatus: o.orderStatus,
            type: o.type,
            createdAt: o.createdAt,

            deliveryChoice: o.deliveryChoice,
            shippingAddress: o.shippingAddress,

            orderSource: o.createdByReception?.name
              ? `Created by ${o.createdByReception.name} for ${o.firmName || o.user?.name || "Unknown"}`
              : `Direct order by ${o.firmName || o.user?.name || "Unknown"}`,

            paidAmount: Number(payment?.paidAmount || 0),
            paymentDetails: payment
              ? {
                  paymentId: payment._id,
                  amount: payment.amount,
                  paidAmount: payment.paidAmount,
                  status: payment.status,
                }
              : null,

            rejectionReason:
              o.orderStatus === "rejected_by_sales"
                ? o.rejectionReason
                : null,

            rejectedBy:
              o.orderStatus === "rejected_by_sales"
                ? o.rejectedBy?.name
                : null,

            products: o.products.map((p) => ({
              productName: p.product?.name,
              boxes: p.boxes,
              price: p.price,
              originalPrice: p.originalPrice,
              total: p.boxes * p.price,
            })),

            statusHistory: o.statusHistory,
            paymentHistory: o.paymentStatusHistory,
          };
        })
      );

      res.json({
        count: formatted.length,
        orders: formatted,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error fetching orders" });
    }
  },

  getChallanRevenueReport: async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      const filter = {};

      // 📅 Date filter
      if (startDate || endDate) {
        filter.date = {};

        if (startDate) {
          filter.date.$gte = new Date(startDate);
        }

        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          filter.date.$lte = end;
        }
      }

        const challans = await Challan.find(filter).lean();

      let totalChallans = challans.length;

      let totalBaseAmount = 0;
      let totalGST = 0;
      let totalAmountWithGST = 0;
      let totalDeliveryCharge = 0;
      let totalWithDelivery = 0;
      let totalWithGSTAndDelivery = 0;

      challans.forEach((c) => {
        const amountWithGST = Number(c.totalAmount || 0);
        const deliveryCharge = Number(c.deliveryCharge || 0);

        // ✅ Extract GST
        const baseAmount = amountWithGST / 1.05;
        const gst = amountWithGST - baseAmount;

        totalBaseAmount += baseAmount;
        totalGST += gst;
        totalAmountWithGST += amountWithGST;
        totalDeliveryCharge += deliveryCharge;

        totalWithDelivery += baseAmount + deliveryCharge;
        totalWithGSTAndDelivery += amountWithGST + deliveryCharge;
      });

      // ✅ Round values
      const round = (num) => Number(num.toFixed(2));
      res.json({
        summary: {
          totalChallans,

          totalAmount: round(totalBaseAmount), // without GST
          totalGST: round(totalGST),
          totalAmountWithGST: round(totalAmountWithGST),

          totalDeliveryCharge: round(totalDeliveryCharge),

          totalAmountWithDelivery: round(totalWithDelivery), // base + delivery
          totalAmountWithGSTAndDelivery: round(totalWithGSTAndDelivery), // final revenue
        },

        filters: {
          startDate: startDate || null,
          endDate: endDate || null,
        },
      });

    } catch (error) {
      console.error("Error fetching challan revenue report:", error);
      res.status(500).json({
        error: "Error fetching challan revenue report",
        details: error.message,
      });
    }
  },

  getAllChallans: async (req, res) => {
    try {
      const { startDate, endDate, status } = req.query;

      const filter = {};

      // 📅 Date Filter
      if (startDate || endDate) {
        filter.date = {};

        if (startDate) {
          filter.date.$gte = new Date(startDate);
        }

        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          filter.date.$lte = end;
        }
      }

      // 📊 Status Filter
      if (status) {
        filter.status = Array.isArray(status)
          ? { $in: status }
          : status;
      }

      const challans = await Challan.find(filter)
        .populate({
          path: "originalOrder",
          select: "orderStatus paymentMethod totalAmountWithDelivery firmName",
        })
        .populate({
          path: "items.productId",
          select: "name category",
        })
        .sort({ createdAt: -1 })
        .lean();

      // 🔥 Format Response
      const formatted = challans.map((c) => {
        const totalAmount = Number(c.totalAmount || 0);
        const gst = Number((totalAmount * 0.05).toFixed(2));
        const totalAmountWithGST = Number((totalAmount + gst).toFixed(2));
        const deliveryCharge = Number(c.deliveryCharge || 0);
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
            boxes: item.boxes,
            rate: item.rate,
            amount: item.amount,
            isExtraItem: item.isExtraItem,
          })),

          totalAmount,
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
            orderAmount: roundAmount(
              c.originalOrder?.totalAmountWithDelivery || 0
            ),
            firmName: c.originalOrder?.firmName,
          },

          rescheduleHistory: c.rescheduleHistory,
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
      });
    }
  },

  async getStockActivities(req, res) {
    try {
      const {
        fromDate,
        toDate,
        type, // preform | bottle | cap | wastage | rawMaterial | usage
        userId
      } = req.query;

      const filter = {};

      // ✅ Date filter
      if (fromDate || toDate) {
        filter.productionDate = {};
        if (fromDate) filter.productionDate.$gte = new Date(fromDate);
        if (toDate) filter.productionDate.$lte = new Date(toDate);
      }

      // For models using "date" instead of productionDate
      const wastageFilter = {};
      if (fromDate || toDate) {
        wastageFilter.date = {};
        if (fromDate) wastageFilter.date.$gte = new Date(fromDate);
        if (toDate) wastageFilter.date.$lte = new Date(toDate);
      }

      // ✅ User filter
      if (userId) {
        filter.recordedBy = userId;
        wastageFilter.recordedBy = userId;
      }

      let results = [];

      // ================= PREORM =================
      if (!type || type === "preform") {
        const preforms = await PreformProduction.find(filter)
          .populate("recordedBy", "name")
          .lean();

        results.push(
          ...preforms.map(item => ({
            type: "preform",
            date: item.productionDate,
            quantity: item.quantityProduced,
            wastage: item.wastageKg,
            remarks: item.remarks,
            user: item.recordedBy?.name
          }))
        );
      }

      // ================= BOTTLE =================
      if (!type || type === "bottle") {
        const bottles = await BottleProduction.find(filter)
          .populate("recordedBy", "name")
          .lean();

        results.push(
          ...bottles.map(item => ({
            type: "bottle",
            date: item.productionDate,
            quantity: item.details?.totalBottles,
            category: item.bottleCategory,
            preformType: item.preformType,
            remarks: item.remarks,
            user: item.recordedBy?.name
          }))
        );
      }

      // ================= CAP =================
      if (!type || type === "cap") {
        const caps = await CapProduction.find(filter)
          .populate("recordedBy", "name")
          .lean();

        results.push(
          ...caps.map(item => ({
            type: "cap",
            date: item.productionDate,
            quantity: item.quantityProduced,
            capType: item.capType,
            capColor: item.capColor,
            remarks: item.remarks,
            user: item.recordedBy?.name
          }))
        );
      }

      // ================= RAW MATERIAL ENTRY =================
      if (!type || type === "rawMaterial") {
        const rawEntries = await RawMaterialEntry.find({
          ...(userId && { enteredBy: userId }),
          ...(fromDate || toDate
            ? {
              entryDate: {
                ...(fromDate && { $gte: new Date(fromDate) }),
                ...(toDate && { $lte: new Date(toDate) })
              }
            }
            : {})
        })
          .populate("enteredBy", "name")
          .populate("rawMaterial", "itemName")
          .lean();

        results.push(
          ...rawEntries.map(item => ({
            type: "rawMaterial",
            date: item.entryDate,
            quantity: item.quantityKg,
            material: item.rawMaterial?.itemName,
            user: item.enteredBy?.name,
            remarks: item.remarks
          }))
        );
      }

      // ================= WASTAGE =================
      if (!type || type === "wastage") {
        const wastages = await Wastage.find(wastageFilter)
          .populate("recordedBy", "name")
          .lean();

        results.push(
          ...wastages.map(item => ({
            type: "wastage",
            date: item.date,
            quantity: item.quantityGenerated,
            wastageType: item.wastageType,
            source: item.source,
            user: item.recordedBy?.name,
            remarks: item.remarks
          }))
        );
      }

      // ================= DIRECT USAGE =================
      if (!type || type === "usage") {
        const usages = await DirectUsage.find({
          ...(userId && { recordedBy: userId }),
          ...(fromDate || toDate
            ? {
              usageDate: {
                ...(fromDate && { $gte: new Date(fromDate) }),
                ...(toDate && { $lte: new Date(toDate) })
              }
            }
            : {})
        })
          .populate("recordedBy", "name")
          .populate("material", "itemName")
          .lean();

        results.push(
          ...usages.map(item => ({
            type: "usage",
            date: item.usageDate,
            quantity: item.quantity,
            material: item.material?.itemName,
            purpose: item.purpose,
            user: item.recordedBy?.name,
            remarks: item.remarks
          }))
        );
      }

      // ✅ Sort by date (latest first)
      results.sort((a, b) => new Date(b.date) - new Date(a.date));

      return res.status(200).json({
        success: true,
        count: results.length,
        data: results
      });

    } catch (error) {
      console.error("Error fetching stock activities:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

};

module.exports = adminController;
