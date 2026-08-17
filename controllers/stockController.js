const mongoose = require("mongoose");
const Stock = require("../models/Stock");
const Product = require("../models/Product");
const Attendance = require("../models/Attendance");
const cloudinary = require("../config/cloudinary");
const streamifier = require("streamifier");
const RawMaterial = require("../models/RawMaterial");
const OutcomeItem = require("../models/OutcomeItem");
const RawMaterialEntry = require("../models/RawMaterialEntry");
const ProductionOutcome = require("../models/ProductionOutcome");
const PreformType = require("../models/PreformType");
const Formula = require("../models/Formula");
const Category = require("../models/Category");
const DirectUsage = require("../models/DirectUsage");
const PerformProduction = require("../models/PreformProduction");
const CapProduction = require("../models/CapProduction");
const BottleProduction = require("../models/BottleProduction");
const Label = require("../models/Label");
const Cap = require("../models/Cap");
const PreformProduction = require("../models/PreformProduction");

const PreformProductionLogs = require("../models/PreformProductionLogs");
const Wastage = require("../models/Wastage");

class StockController {
  async getAllProducts(req, res) {
    try {
      const products = await Product.find({ isActive: true }).select(
        "name description price boxes image type category bottlesPerBox"
      );

      res.status(200).json({
        success: true,
        data: products,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error fetching products",
        error: error.message,
      });
    }
  }

  async updateQuantity(req, res) {
    try {
      const { productId, boxes, changeType, notes } = req.body;
      const userId = req.user.id;

      if (!productId || !boxes || !changeType) {
        return res.status(400).json({
          success: false,
          message: "productId, boxes, and changeType are required",
        });
      }

      const changeBoxes = parseInt(boxes);
      if (isNaN(changeBoxes) || changeBoxes <= 0) {
        return res.status(400).json({
          success: false,
          message: "Boxes must be a positive number",
        });
      }

      const product = await Product.findById(productId);

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      if (product.boxes < 0) {
        product.boxes = 0;
        await product.save();
      }

      let newBoxes = product.boxes;
      if (changeType === "addition") {
        newBoxes += changeBoxes;
      } else if (changeType === "reduction") {
        newBoxes -= changeBoxes;
        if (newBoxes < 0) {
          return res.status(400).json({
            success: false,
            message: "Insufficient stock boxes",
          });
        }
      } else if (changeType === "adjustment") {
        newBoxes = changeBoxes;
      } else {
        return res.status(400).json({
          success: false,
          message: "Invalid changeType",
        });
      }

      const remark = {
        message: `Stock ${changeType}: ${changeBoxes} boxes. ${notes || ""}`,
        updatedBy: userId,
        boxes: changeBoxes,
        changeType: changeType,
      };

      await Product.findByIdAndUpdate(productId, {
        $set: { boxes: newBoxes },
        $push: {
          stockRemarks: {
            $each: [remark],
            $position: 0,
          },
        },
      });

      let stockUpdate = await Stock.findOne({ productId });
      if (!stockUpdate) {
        stockUpdate = new Stock({
          productId,
          quantity: newBoxes,
          updatedBy: userId,
          updateHistory: [],
        });
      }

      stockUpdate.updateQuantity(
        newBoxes,
        userId,
        changeType,
        notes,
        changeBoxes
      );
      await stockUpdate.save();

      res.status(200).json({
        success: true,
        data: {
          product: await Product.findById(productId),
          stockUpdate,
        },
        message: "Stock boxes updated successfully",
      });
    } catch (error) {
      console.error("Error updating stock boxes:", error);
      res.status(500).json({
        success: false,
        message: "Error updating stock boxes",
        error: error.message,
      });
    }
  }

  async getStockHistory(req, res) {
    try {
      const { productId } = req.params;
      const stockHistory = await Stock.findOne({ productId })
        .populate("updateHistory.updatedBy", "name")
        .populate("productId", "name");

      if (!stockHistory) {
        return res.status(404).json({
          success: false,
          message: "No stock history found for this product",
        });
      }

      res.status(200).json({
        success: true,
        data: stockHistory,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error fetching stock history",
        error: error.message,
      });
    }
  }

  async getallStockHistory(req, res) {
    try {
      const stockHistory = await Stock.find()
        .populate("updateHistory.updatedBy", "name")
        .populate("productId", "name");

      if (!stockHistory || stockHistory.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No stock history found",
        });
      }

      res.status(200).json({
        success: true,
        data: stockHistory,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error fetching stock history",
        error: error.message,
      });
    }
  }

  async checkIn(req, res) {
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
        panel: "stock",
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
        panel: "stock",
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
  }

  async checkOut(req, res) {
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
        panel: "stock",
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
  }

  async getDailyStockUpdates(req, res) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const stockUpdates = await Stock.find({
        "updateHistory.updatedAt": { $gte: today },
        "updateHistory.updatedBy": req.user._id,
      }).populate("productId", "name");

      res.json({
        dailyStockUpdates: stockUpdates,
      });
    } catch (error) {
      res.status(500).json({
        error: "Error fetching daily stock updates",
        details: error.message,
      });
    }
  }


  async addRawMaterialItem(req, res) {
    try {
      const { itemName, itemCode, subcategory, unit, supplier, minStockLevel, remarks } = req.body;

      if (!itemName || !itemCode) {
        return res.status(400).json({ success: false, message: "itemName and itemCode are required" });
      }

      const exists = await RawMaterial.findOne({ itemCode });
      if (exists) {
        return res.status(400).json({ success: false, message: "Item code already exists" });
      }

      const rawMaterial = new RawMaterial({
        itemName,
        itemCode,
        subcategory,
        unit,
        supplier,
        minStockLevel: minStockLevel || 0,
        remarks
      });

      await rawMaterial.save();
      res.status(201).json({ success: true, data: rawMaterial });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async updateRawMaterial(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const material = await RawMaterial.findByIdAndUpdate(
        id,
        updateData,
        { new: true, runValidators: true }
      );

      if (!material) {
        return res.status(404).json({ success: false, message: "Raw material not found" });
      }

      res.status(200).json({ success: true, data: material });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async deleteRawMaterial(req, res) {
    try {
      const { id } = req.params;

      const material = await RawMaterial.findByIdAndUpdate(
        id,
        { isActive: false },
        { new: true }
      );

      if (!material) {
        return res.status(404).json({ success: false, message: "Raw material not found" });
      }

      res.status(200).json({ success: true, message: "Raw material deleted successfully" });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }



  async getCurrentStock(req, res) {
    try {
      const materials = await RawMaterial.find({ isActive: true })
        .select("itemName itemCode subcategory unit supplier minStockLevel currentStock")
        .sort({ itemName: 1 });

      const stockWithAlerts = materials.map(material => ({
        ...material.toObject(),
        lowStockAlert: material.currentStock <= material.minStockLevel
      }));

      res.status(200).json({ success: true, data: stockWithAlerts });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async recordPreformProduction(req, res) {
    try {
      const {
        rawMaterials,
        preformTypeId,
        quantityProduced,
        wastageType1,
        wastageType2,
        remarks,
        productionDate
      } = req.body;

      const userId = req.user.id;

      if (!rawMaterials || !preformTypeId || !quantityProduced) {
        return res.status(400).json({
          success: false,
          message: "Raw materials, preform type and quantity produced are required"
        });
      }

      const preform = await PreformType.findById(preformTypeId);

      if (!preform || !preform.isActive) {
        return res.status(404).json({
          success: false,
          message: "Invalid preform type"
        });
      }
      
      const totalInputKg = rawMaterials.reduce((sum, rm) => sum + Number(rm.quantityUsed), 0);
      const finishedGoodKg = Number(quantityProduced) || 0;
      const lumpsScrapKg = Number(wastageType1) || 0;
      const petChipsScrapKg = Number(wastageType2) || 0;
      
      const totalOutputKg = finishedGoodKg + lumpsScrapKg + petChipsScrapKg;
      
      if (Math.abs(totalInputKg - totalOutputKg) > 0.01) {
        return res.status(400).json({
          success: false,
          message: `Mass balance mismatch! Total Input (${totalInputKg} Kg) does not equal Finished Good + Wastage (${totalOutputKg} Kg).`
        });
      }

      const normalizedPreformType = preform.name.toLowerCase();

      for (const rm of rawMaterials) {
        const material = await RawMaterial.findById(rm.materialId);

        if (!material) {
          return res.status(404).json({
            success: false,
            message: `Raw material ${rm.materialId} not found`
          });
        }

        if (material.currentStock < rm.quantityUsed) {
          return res.status(400).json({
            success: false,
            message: `Insufficient stock for ${material.itemName}. Available: ${material.currentStock}, Required: ${rm.quantityUsed}`
          });
        }
      }

      for (const rm of rawMaterials) {
        await RawMaterial.findByIdAndUpdate(
          rm.materialId,
          { $inc: { currentStock: -rm.quantityUsed } }
        );
      }

      const totalWastage = (wastageType1 || 0) + (wastageType2 || 0);

      const production = await PreformProduction.findOneAndUpdate(
        {
          type: "preform",
          outcomeType: normalizedPreformType
        },
        {
          $inc: {
            quantityProduced,
            wastageKg: totalWastage,
            wastageType1: wastageType1 || 0,
            wastageType2: wastageType2 || 0
          },
          $set: {
            remarks,
            productionDate: productionDate ? new Date(productionDate) : new Date(),
            recordedBy: userId
          },
          $push: {
            rawMaterials: rawMaterials.map(rm => ({
              material: rm.materialId,
              quantityUsed: rm.quantityUsed
            }))
          }
        },
        {
          upsert: true,
          new: true
        }
      );

      await PreformProductionLogs.create({
        preformProductionId: production._id,
        preformType: normalizedPreformType,
        rawMaterials: rawMaterials.map(rm => ({
          material: rm.materialId,
          quantityUsed: rm.quantityUsed
        })),
        quantityProduced,
        wastageType1: wastageType1 || 0,
        wastageType2: wastageType2 || 0,
        totalWastage,
        remarks,
        productionDate: productionDate ? new Date(productionDate) : new Date(),
        recordedBy: userId
      });

      if (wastageType1 > 0) {
        await new Wastage({
          wastageType: "Type 1: Reusable Wastage",
          source: "Preform",
          quantityGenerated: wastageType1,
          quantityReused: 0,
          remarks: `Generated from preform production of ${normalizedPreformType}`,
          recordedBy: userId
        }).save();
      }

      if (wastageType2 > 0) {
        await new Wastage({
          wastageType: "Type 2: Non-reusable / Scrap",
          source: "Preform",
          quantityGenerated: wastageType2,
          quantityReused: 0,
          quantityScrapped: wastageType2,
          remarks: `Generated from preform production of ${normalizedPreformType}`,
          recordedBy: userId
        }).save();
      }

      await production.populate("rawMaterials.material", "itemName itemCode unit");
      await production.populate("recordedBy", "name");

      res.status(201).json({
        success: true,
        data: production,
        message: "Preform production recorded successfully"
      });

    } catch (error) {
      console.error("Error in preform production:", error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async addPreformType(req, res) {
    try {
      const { name, description, initialStockKg } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Preform type name is required",
        });
      }

      const normalizedName = name.trim().toLowerCase();

      const exists = await PreformType.findOne({
        name: normalizedName,
      });

      if (exists) {
        return res.status(400).json({
          success: false,
          message: "Preform type already exists",
        });
      }

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const preformType = await PreformType.create([{
          name: normalizedName,
          description: description || ""
        }], { session });

        if (initialStockKg && Number(initialStockKg) > 0) {
          const PreformProduction = require("../models/PreformProduction");
          await PreformProduction.create([{
            outcomeType: normalizedName,
            quantityProduced: Number(initialStockKg),
            type: "preform",
            remarks: "Initial stock entry",
            recordedBy: req.user.id
          }], { session });
        }

        await session.commitTransaction();
        session.endSession();

        return res.status(201).json({
          success: true,
          data: preformType[0],
          message: "Preform type created successfully",
        });

      } catch (err) {
        await session.abortTransaction();
        session.endSession();
        throw err;
      }

    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
  async getAllPreformTypes(req, res) {
    try {
      const types = await PreformType.find({ isActive: true })
        .sort({ createdAt: -1 })
        .lean();

      return res.status(200).json({
        success: true,
        count: types.length,
        data: types,
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async updatePreformType(req, res) {
    try {
      const { id } = req.params;
      const { name, description, isActive, weightGm } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Preform type ID is required",
        });
      }

      const existing = await PreformType.findById(id);
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: "Preform type not found",
        });
      }

      let normalizedName = existing.name;

      if (name && name.trim()) {
        normalizedName = name.trim().toLowerCase();

        // Check if new name conflicts with another existing type
        const duplicate = await PreformType.findOne({
          name: normalizedName,
          _id: { $ne: id },
        });

        if (duplicate) {
          return res.status(400).json({
            success: false,
            message: "Another preform type with this name already exists",
          });
        }
      }

      const updateData = {
        name: normalizedName,
      };

      if (description !== undefined) {
        updateData.description = description;
      }

      if (isActive !== undefined) {
        updateData.isActive = isActive;
      }

      const updated = await PreformType.findByIdAndUpdate(
        id,
        updateData,
        { new: true, runValidators: true }
      );

      return res.status(200).json({
        success: true,
        data: updated,
        message: "Preform type updated successfully",
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
  async deletePreformType(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Preform type ID is required",
        });
      }

      const deleted = await PreformType.findByIdAndUpdate(
        id,
        { isActive: false },
        { new: true }
      );

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: "Preform type not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Preform type deleted successfully",
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getPreformProductionsWithReport(req, res) {
    try {
      const {
        preformType,
        startDate,
        endDate,
        page = 1,
        limit = 20,
        sortBy = 'productionDate',
        sortOrder = 'desc',
        downloadReport
      } = req.query;

      let filter = { type: "preform" };

      if (preformType) {
        filter.outcomeType = preformType;
      }

      if (startDate && endDate) {
        filter.productionDate = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      } else if (startDate) {
        filter.productionDate = { $gte: new Date(startDate) };
      } else if (endDate) {
        filter.productionDate = { $lte: new Date(endDate) };
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const sortOptions = {};
      sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

      const totalRecords = await PerformProduction.countDocuments(filter);

      const productions = await PerformProduction.find(filter)
        .populate("rawMaterials.material", "itemName itemCode unit")
        .populate("recordedBy", "name email")
        .sort(sortOptions)
        .skip(downloadReport ? 0 : skip)
        .limit(downloadReport ? 0 : parseInt(limit));

      const productionsWithStats = productions.map(prod => {
        const available = prod.quantityProduced - (prod.wastageKg || 0) - (prod.usedInBottles || 0);
        return {
          ...prod.toObject(),
          statistics: {
            available: Math.max(0, available),
            usagePercentage: ((prod.usedInBottles || 0) / prod.quantityProduced * 100).toFixed(2),
            wastagePercentage: ((prod.wastageKg || 0) / prod.quantityProduced * 100).toFixed(2),
            isFullyUtilized: available <= 0
          }
        };
      });

      if (downloadReport) {
        return res.status(200).json({
          success: true,
          data: productionsWithStats,
          reportType: 'preform_production',
          generatedAt: new Date()
        });
      }

      res.status(200).json({
        success: true,
        data: productionsWithStats,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalRecords / parseInt(limit)),
          totalRecords,
          recordsPerPage: parseInt(limit),
          hasNextPage: skip + productions.length < totalRecords,
          hasPrevPage: parseInt(page) > 1
        }
      });
    } catch (error) {
      console.error("Error fetching preform productions:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching preform productions",
        error: error.message
      });
    }
  }

  async getPreformProductionsLog(req, res) {
    try {
      const { id } = req.params
      console.log(req.params)
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          status: false,
          message: "Invalid preform production id"
        })
      }

      const preform = await PreformProduction.findById(id)
        .select("outcomeType quantityProduced wastageKg")
        .lean();

      if (!preform) {
        return res.status(404).json({
          status: false,
          message: "Preform production not found"
        });
      }

      const logs = await PreformProductionLogs.find({
        preformProductionId: id
      })
        .populate("rawMaterials.material", "itemName itemCode unit")
        .populate("recordedBy", "name")
        .sort({ productionDate: -1 })
        .lean();


      return res.status(200).json({
        status: true,
        preform: {
          id,
          preformType: preform.outcomeType,
          totalProduced: preform.quantityProduced,
          totalWastage: preform.wastageKg
        },
        count: logs.length,
        data: logs
      })
    }
    catch (error) {
      console.log("Error while getPreformProductionsLog", error.message)
      return res.status(500).json({
        status: false,
        message: "Internal Server Error"
      })
    }
  }

  async getPreformProductions(req, res) {
    try {
      const {
        preformType,
        startDate,
        endDate,
        page = 1,
        limit = 20,
        sortBy = 'productionDate',
        sortOrder = 'desc'
      } = req.query;

      let filter = { type: "preform" };

      if (preformType) {
        filter.outcomeType = preformType;
      }

      if (startDate && endDate) {
        filter.productionDate = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      } else if (startDate) {
        filter.productionDate = { $gte: new Date(startDate) };
      } else if (endDate) {
        filter.productionDate = { $lte: new Date(endDate) };
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const sortOptions = {};
      sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

      const totalRecords = await PerformProduction.countDocuments(filter);

      const productions = await PerformProduction.find(filter)
        .populate("rawMaterials.material", "itemName itemCode unit")
        .populate("recordedBy", "name email")
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit));

      const productionsWithStats = productions.map(prod => {
        const available = prod.quantityProduced - (prod.usedInBottles || 0);
        return {
          ...prod.toObject(),
          statistics: {
            available: Math.max(0, available),
            usagePercentage: ((prod.usedInBottles || 0) / prod.quantityProduced * 100).toFixed(2),
            wastagePercentage: ((prod.wastageKg || 0) / prod.quantityProduced * 100).toFixed(2),
            isFullyUtilized: available <= 0
          }
        };
      });

      res.status(200).json({
        success: true,
        data: productionsWithStats,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalRecords / parseInt(limit)),
          totalRecords,
          recordsPerPage: parseInt(limit),
          hasNextPage: skip + productions.length < totalRecords,
          hasPrevPage: parseInt(page) > 1
        }
      });
    } catch (error) {
      console.error("Error fetching preform productions:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching preform productions",
        error: error.message
      });
    }
  }

  async recordCapProduction(req, res) {
    try {
      const {
        rawMaterials,
        caps,
        boxesUsed,
        bagsUsed,
        wastageType1,
        wastageType2,
        remarks,
        productionDate
      } = req.body;

      const userId = req.user.id;

      if (!rawMaterials || !caps || caps.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Raw materials and caps array are required"
        });
      }

      for (const rm of rawMaterials) {
        const material = await RawMaterial.findById(rm.materialId);

        if (!material) {
          return res.status(404).json({
            success: false,
            message: `Raw material ${rm.materialId} not found`
          });
        }

        if (material.currentStock < rm.quantityUsed) {
          return res.status(400).json({
            success: false,
            message: `Insufficient stock for ${material.itemName}`
          });
        }

        await RawMaterial.findByIdAndUpdate(
          rm.materialId,
          { $inc: { currentStock: -rm.quantityUsed } }
        );
      }

      if (boxesUsed > 0) {
        const capBoxes = await RawMaterial.findOne({ itemCode: "CAP_BOXES" });
        if (capBoxes) {
          await RawMaterial.findByIdAndUpdate(
            capBoxes._id,
            { $inc: { currentStock: -boxesUsed } }
          );
        }
      }

      if (bagsUsed > 0) {
        const capBags = await RawMaterial.findOne({ itemCode: "CAP_BAGS" });
        if (capBags) {
          await RawMaterial.findByIdAndUpdate(
            capBags._id,
            { $inc: { currentStock: -bagsUsed } }
          );
        }
      }

      const totalWastage = (wastageType1 || 0) + (wastageType2 || 0);

      const productions = [];

      for (const item of caps) {
        const { capId, quantityProduced } = item;

        if (!capId || !quantityProduced || quantityProduced <= 0) {
          return res.status(400).json({
            success: false,
            message: "Each cap must have capId and quantityProduced"
          });
        }

        const cap = await Cap.findById(capId);

        if (!cap || !cap.isActive) {
          return res.status(404).json({
            success: false,
            message: `Cap not found for id ${capId}`
          });
        }

        const capType = cap.neckType;
        const capColor = cap.color;

        const production = new CapProduction({
          rawMaterials: rawMaterials.map(rm => ({
            material: rm.materialId,
            quantityUsed: rm.quantityUsed
          })),
          capId,
          capType,
          capColor,
          quantityProduced,
          packagingUsed: {
            boxes: boxesUsed || 0,
            bags: bagsUsed || 0
          },
          wastage: totalWastage,
          wastageType1: wastageType1 || 0,
          wastageType2: wastageType2 || 0,
          remarks,
          productionDate: productionDate
            ? new Date(productionDate)
            : new Date(),
          recordedBy: userId
        });

        await production.save();

        await Cap.findByIdAndUpdate(
          capId,
          {
            $inc: { quantityAvailable: quantityProduced },
            $set: { lastUpdatedBy: userId }
          }
        );

        productions.push(production);
      }

      if (wastageType1 > 0) {
        await new Wastage({
          wastageType: "Type 1: Reusable Wastage",
          source: "Cap",
          quantityGenerated: wastageType1,
          quantityReused: 0,
          remarks: `Generated from cap production`,
          recordedBy: userId
        }).save();
      }

      if (wastageType2 > 0) {
        await new Wastage({
          wastageType: "Type 2: Non-reusable / Scrap",
          source: "Cap",
          quantityGenerated: wastageType2,
          quantityReused: 0,
          quantityScrapped: wastageType2,
          remarks: `Generated from cap production`,
          recordedBy: userId
        }).save();
      }

      return res.status(201).json({
        success: true,
        message: "Multiple cap productions recorded successfully",
        data: productions
      });

    } catch (error) {
      console.error("Error in cap production:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async getCapProductionsWithReport(req, res) {
    try {
      const {
        capType,
        capColor,
        startDate,
        endDate,
        page = 1,
        limit = 20,
        sortBy = 'productionDate',
        sortOrder = 'desc',
        downloadReport
      } = req.query;

      let filter = {};

      if (capType) {
        filter.capType = capType;
      }

      if (capColor) {
        filter.capColor = capColor;
      }

      if (startDate && endDate) {
        filter.productionDate = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      } else if (startDate) {
        filter.productionDate = { $gte: new Date(startDate) };
      } else if (endDate) {
        filter.productionDate = { $lte: new Date(endDate) };
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const sortOptions = {};
      sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

      const totalRecords = await CapProduction.countDocuments(filter);

      const productions = await CapProduction.find(filter)
        .populate("rawMaterials.material", "itemName itemCode unit")
        .populate("recordedBy", "name email")
        .sort(sortOptions)
        .skip(downloadReport ? 0 : skip)
        .limit(downloadReport ? 0 : parseInt(limit));

      const productionsWithStats = productions.map(prod => {
        const available = prod.quantityProduced - (prod.wastage || 0) - (prod.usedInBottles || 0);
        return {
          ...prod.toObject(),
          statistics: {
            available: Math.max(0, available),
            usagePercentage: ((prod.usedInBottles || 0) / prod.quantityProduced * 100).toFixed(2),
            wastagePercentage: ((prod.wastage || 0) / prod.quantityProduced * 100).toFixed(2),
            isFullyUtilized: available <= 0
          }
        };
      });

      if (downloadReport) {
        return res.status(200).json({
          success: true,
          data: productionsWithStats,
          reportType: 'cap_production',
          generatedAt: new Date()
        });
      }

      res.status(200).json({
        success: true,
        data: productionsWithStats,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalRecords / parseInt(limit)),
          totalRecords,
          recordsPerPage: parseInt(limit),
          hasNextPage: skip + productions.length < totalRecords,
          hasPrevPage: parseInt(page) > 1
        }
      });
    } catch (error) {
      console.error("Error fetching cap productions:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching cap productions",
        error: error.message
      });
    }
  }


  async getCapProductions(req, res) {
    try {
      const {
        capType,
        capColor,
        startDate,
        endDate,
        page = 1,
        limit = 20,
        sortBy = 'productionDate',
        sortOrder = 'desc'
      } = req.query;

      let filter = {};

      if (capType) {
        filter.capType = capType;
      }

      if (capColor) {
        filter.capColor = capColor;
      }

      if (startDate && endDate) {
        filter.productionDate = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      } else if (startDate) {
        filter.productionDate = { $gte: new Date(startDate) };
      } else if (endDate) {
        filter.productionDate = { $lte: new Date(endDate) };
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const sortOptions = {};
      sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

      const totalRecords = await CapProduction.countDocuments(filter);

      const productions = await CapProduction.find(filter)
        .populate("rawMaterials.material", "itemName itemCode unit")
        .populate("recordedBy", "name email")
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit));

      const productionsWithStats = productions.map(prod => {
        const available = prod.quantityProduced - (prod.wastage || 0) - (prod.usedInBottles || 0);
        return {
          ...prod.toObject(),
          statistics: {
            available: Math.max(0, available),
            usagePercentage: ((prod.usedInBottles || 0) / prod.quantityProduced * 100).toFixed(2),
            wastagePercentage: ((prod.wastage || 0) / prod.quantityProduced * 100).toFixed(2),
            isFullyUtilized: available <= 0
          }
        };
      });

      res.status(200).json({
        success: true,
        data: productionsWithStats,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalRecords / parseInt(limit)),
          totalRecords,
          recordsPerPage: parseInt(limit),
          hasNextPage: skip + productions.length < totalRecords,
          hasPrevPage: parseInt(page) > 1
        }
      });
    } catch (error) {
      console.error("Error fetching cap productions:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching cap productions",
        error: error.message
      });
    }
  }

  // ============= BOTTLE TYPE MANAGEMENT =============
  async addBottleType(req, res) {
    try {
      const { bottleName, category, bottlesPerBox, preformGramage } = req.body;
      if (!bottleName || !category || !bottlesPerBox || preformGramage === undefined) {
        return res.status(400).json({ success: false, message: "All fields are required" });
      }
      const existing = await BottleType.findOne({ bottleName });
      if (existing) {
        return res.status(400).json({ success: false, message: "Bottle type name already exists" });
      }
      const bottleType = new BottleType({ bottleName, category, bottlesPerBox, preformGramage });
      await bottleType.save();
      res.status(201).json({ success: true, data: bottleType, message: "Bottle type added" });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async updateBottleType(req, res) {
    try {
      const { id } = req.params;
      const { bottlesPerBox, preformGramage } = req.body;

      const product = await Product.findById(id);
      if (!product) return res.status(404).json({ success: false, message: "Not found" });

      if (bottlesPerBox !== undefined) product.bottlesPerBox = bottlesPerBox;
      if (preformGramage !== undefined) product.preformGramage = preformGramage;

      await product.save();
      res.status(200).json({ success: true, data: product, message: "Updated" });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async deleteBottleType(req, res) {
    try {
      await BottleType.findByIdAndDelete(req.params.id);
      res.status(200).json({ success: true, message: "Deleted" });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async getBottleTypes(req, res) {
    try {
      const products = await Product.find({ type: "Bottle", isActive: true }).sort({ createdAt: -1 });
      const types = products.map(p => ({
        _id: p._id,
        bottleName: p.name,
        category: p.category,
        bottlesPerBox: p.bottlesPerBox || 0,
        preformGramage: p.preformGramage || 0
      }));
      res.status(200).json({ success: true, data: types });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async recordBottleProduction(req, res) {
    const mongoose = require("mongoose");

    try {
      const {
        preformTypeId,
        producedBottles,
        bottleRejectionKg = 0,
        preformRejectionKg = 0,
        remarks,
        productionDate
      } = req.body;

      const userId = req.user.id;

      if (!preformTypeId || !producedBottles || producedBottles.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Preform type and produced bottles array are required"
        });
      }

      const preform = await PreformType.findById(preformTypeId);

      if (!preform || !preform.isActive) {
        return res.status(404).json({
          success: false,
          message: "Invalid preform type"
        });
      }

      const normalizedPreformType = preform.name.toLowerCase().trim();

      let formulaUsageKg = 0;

      for (const item of producedBottles) {
        if (!item.bottleName || !item.boxesProduced || !item.bottlesPerBox || item.preformGramage === undefined || !item.labelId || !item.capId) {
          return res.status(400).json({
            success: false,
            message: "Each bottle entry must have all required fields including label and cap"
          });
        }
        
        item.totalBottles = item.boxesProduced * item.bottlesPerBox;
        formulaUsageKg += (item.totalBottles * item.preformGramage) / 1000;
      }
      
      const totalPreformRequiredKg = formulaUsageKg + Number(bottleRejectionKg) + Number(preformRejectionKg);

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const preformProductions = await PreformProduction.find({
          outcomeType: normalizedPreformType,
          $expr: {
            $gt: [
              {
                $subtract: [
                  "$quantityProduced",
                  { $add: ["$wastageKg", { $ifNull: ["$usedInBottles", 0] }] }
                ]
              },
              0
            ]
          }
        })
          .sort({ productionDate: 1 })
          .session(session);

        let totalAvailableKg = 0;
        preformProductions.forEach(p => {
          const available = p.quantityProduced - (p.wastageKg || 0) - (p.usedInBottles || 0);
          totalAvailableKg += Math.max(0, available);
        });

        if (totalAvailableKg < totalPreformRequiredKg) {
          throw new Error(`Insufficient preforms. Available: ${totalAvailableKg.toFixed(2)} kg, Required: ${totalPreformRequiredKg.toFixed(2)} kg`);
        }

        let remainingKg = totalPreformRequiredKg;
        const preformBatchUsage = [];

        for (const prod of preformProductions) {
          if (remainingKg <= 0) break;
          const available = prod.quantityProduced - (prod.wastageKg || 0) - (prod.usedInBottles || 0);
          if (available > 0) {
            const deduct = Math.min(available, remainingKg);
            await PreformProduction.findByIdAndUpdate(prod._id, { $inc: { usedInBottles: deduct } }, { session });
            preformBatchUsage.push({ batchId: prod._id, quantityUsed: deduct });
            remainingKg -= deduct;
          }
        }

        let totalBottlesAll = 0;
        let totalShrinkRollKg = 0;
        
        for (const item of producedBottles) {
          const totalBottles = item.totalBottles;
          totalBottlesAll += totalBottles;

          const label = await Label.findOneAndUpdate(
            { _id: item.labelId, quantityAvailable: { $gte: totalBottles } },
            { $inc: { quantityAvailable: -totalBottles }, $set: { lastUpdatedBy: userId } },
            { new: true, session }
          );
          if (!label) throw new Error(`Insufficient label stock for ${item.bottleName}`);

          const cap = await Cap.findOneAndUpdate(
            { _id: item.capId, quantityAvailable: { $gte: totalBottles } },
            { $inc: { quantityAvailable: -totalBottles }, $set: { lastUpdatedBy: userId } },
            { new: true, session }
          );
          if (!cap) throw new Error(`Insufficient cap stock for ${item.bottleName}`);
          
          // Shrink Roll calculation per box
          const bName = (item.bottleName || "").toLowerCase();
          let factor = 0;
          if (bName.includes("200ml") || bName.includes("250ml")) {
             factor = 0.042;
          } else if (bName.includes("500ml")) {
             factor = (label.bottleName && label.bottleName.toLowerCase().includes("round")) ? 0.053 : 0.046;
          } else if (bName.includes("700ml") || bName.includes("900ml") || bName.includes("1l") || bName.includes("1000ml")) {
             factor = 0.055;
          }
          
          if (factor > 0) {
             totalShrinkRollKg += (item.boxesProduced * factor);
          }
        }

        // Deduct Shrink Roll from RawMaterial stock (can go negative)
        if (totalShrinkRollKg > 0) {
           await RawMaterial.findOneAndUpdate(
             { itemName: { $regex: /shrink\s*roll/i } },
             { $inc: { currentStock: -totalShrinkRollKg } },
             { session }
           );
        }

        const production = new BottleProduction({
          preformType: preform._id,
          producedBottles: producedBottles,
          bottleRejectionKg: Number(bottleRejectionKg),
          preformRejectionKg: Number(preformRejectionKg),
          totalPreformUsedKg: totalPreformRequiredKg,
          details: {
            totalBottles: totalBottlesAll,
            preformBatchUsage,
            shrinkRollUsed: Number(totalShrinkRollKg.toFixed(3))
          },
          remarks,
          productionDate: productionDate ? new Date(productionDate) : new Date(),
          recordedBy: userId
        });

        await production.save({ session });

        await session.commitTransaction();
        session.endSession();

        return res.status(201).json({
          success: true,
          message: "Bottle production recorded successfully",
          data: production
        });

      } catch (err) {
        await session.abortTransaction();
        session.endSession();
        throw err;
      }

    } catch (error) {
      console.error("Error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async getBottleCategory(req, res) {
    try {
      const products = await Product.find({ isActive: true })
        .select("name type category bottlesPerBox")
        .lean();
      const preformTypes = await PreformType.find({ isActive: true })
        .select("_id name description")
        .sort({ name: 1 })
        .lean();

      if (!products.length) {
        return res.status(404).json({
          status: false,
          message: "No products found"
        });
      }

      return res.status(200).json({
        status: true,
        message: "Bottle categories and preform types fetched successfully",
        data: {
          bottleCategories: products,
          preformTypes: preformTypes
        }
      });

    } catch (error) {
      console.error("Error while fetching bottle category", error.message);
      return res.status(500).json({
        status: false,
        message: "Internal Server Error"
      });
    }
  }

  async getBottleProductions(req, res) {
    try {
      const {
        bottleCategory,
        startDate,
        endDate,
        page = 1,
        limit = 20,
        sortBy = "productionDate",
        sortOrder = "desc"
      } = req.query;

      let filter = {};

      if (bottleCategory) {
        filter.bottleCategory = bottleCategory;
      }

      if (startDate && endDate) {
        filter.productionDate = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      } else if (startDate) {
        filter.productionDate = { $gte: new Date(startDate) };
      } else if (endDate) {
        filter.productionDate = { $lte: new Date(endDate) };
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const sortOptions = {};
      sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;

      const totalRecords = await BottleProduction.countDocuments(filter);

      const productions = await BottleProduction.find(filter)
        // ✅ POPULATE PREFORM TYPE
        .populate("preformType", "name description isActive")
        .populate("recordedBy", "name email")
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit));

      res.status(200).json({
        success: true,
        data: productions,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalRecords / parseInt(limit)),
          totalRecords,
          recordsPerPage: parseInt(limit),
          hasNextPage: skip + productions.length < totalRecords,
          hasPrevPage: parseInt(page) > 1
        }
      });

    } catch (error) {
      console.error("Error fetching bottle productions:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching bottle productions",
        error: error.message
      });
    }
  }


  async getPreformProductionReport(req, res) {
    try {
      const { period, startDate, endDate } = req.query;

      let filter = { type: "preform" };
      let dateFilter = {};

      if (period === 'daily') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        dateFilter = { $gte: today };
      } else if (period === 'weekly') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        dateFilter = { $gte: weekAgo };
      } else if (period === 'monthly') {
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        dateFilter = { $gte: monthAgo };
      } else if (startDate && endDate) {
        dateFilter = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      }

      if (Object.keys(dateFilter).length > 0) {
        filter.productionDate = dateFilter;
      }

      const productions = await PerformProduction.find(filter)
        .populate("rawMaterials.material", "itemName itemCode unit")
        .populate("recordedBy", "name")
        .sort({ productionDate: -1 });

      // Calculate summary
      const summary = {
        totalProductions: productions.length,
        totalQuantityProduced: 0,
        totalWastageType1: 0,
        totalWastageType2: 0,
        totalWastage: 0,
        totalUsedInBottles: 0,
        byPreformType: {}
      };

      productions.forEach(prod => {
        summary.totalQuantityProduced += prod.quantityProduced;
        summary.totalWastageType1 += prod.wastageType1 || 0;
        summary.totalWastageType2 += prod.wastageType2 || 0;
        summary.totalWastage += prod.wastageKg || 0;
        summary.totalUsedInBottles += prod.usedInBottles || 0;

        if (!summary.byPreformType[prod.outcomeType]) {
          summary.byPreformType[prod.outcomeType] = {
            quantityProduced: 0,
            wastage: 0,
            usedInBottles: 0
          };
        }
        summary.byPreformType[prod.outcomeType].quantityProduced += prod.quantityProduced;
        summary.byPreformType[prod.outcomeType].wastage += prod.wastageKg || 0;
        summary.byPreformType[prod.outcomeType].usedInBottles += prod.usedInBottles || 0;
      });

      res.status(200).json({
        success: true,
        reportType: 'preform_production',
        period: period || 'custom',
        dateRange: {
          start: filter.productionDate?.$gte || null,
          end: filter.productionDate?.$lte || null
        },
        summary,
        data: productions,
        generatedAt: new Date()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error generating preform production report",
        error: error.message
      });
    }
  }

  async getCapProductionReport(req, res) {
    try {
      const { period, startDate, endDate } = req.query;

      let filter = {};
      let dateFilter = {};

      if (period === 'daily') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        dateFilter = { $gte: today };
      } else if (period === 'weekly') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        dateFilter = { $gte: weekAgo };
      } else if (period === 'monthly') {
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        dateFilter = { $gte: monthAgo };
      } else if (startDate && endDate) {
        dateFilter = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      }

      if (Object.keys(dateFilter).length > 0) {
        filter.productionDate = dateFilter;
      }

      const productions = await CapProduction.find(filter)
        .populate("rawMaterials.material", "itemName itemCode unit")
        .populate("recordedBy", "name")
        .sort({ productionDate: -1 });

      const summary = {
        totalProductions: productions.length,
        totalQuantityProduced: 0,
        totalWastageType1: 0,
        totalWastageType2: 0,
        totalWastage: 0,
        totalUsedInBottles: 0,
        byCapType: {},
        byColor: {}
      };

      productions.forEach(prod => {
        summary.totalQuantityProduced += prod.quantityProduced;
        summary.totalWastageType1 += prod.wastageType1 || 0;
        summary.totalWastageType2 += prod.wastageType2 || 0;
        summary.totalWastage += prod.wastage || 0;
        summary.totalUsedInBottles += prod.usedInBottles || 0;

        if (!summary.byCapType[prod.capType]) {
          summary.byCapType[prod.capType] = {
            quantityProduced: 0,
            wastage: 0,
            usedInBottles: 0
          };
        }
        summary.byCapType[prod.capType].quantityProduced += prod.quantityProduced;
        summary.byCapType[prod.capType].wastage += prod.wastage || 0;
        summary.byCapType[prod.capType].usedInBottles += prod.usedInBottles || 0;

        if (!summary.byColor[prod.capColor]) {
          summary.byColor[prod.capColor] = {
            quantityProduced: 0,
            wastage: 0
          };
        }
        summary.byColor[prod.capColor].quantityProduced += prod.quantityProduced;
        summary.byColor[prod.capColor].wastage += prod.wastage || 0;
      });

      res.status(200).json({
        success: true,
        reportType: 'cap_production',
        period: period || 'custom',
        dateRange: {
          start: filter.productionDate?.$gte || null,
          end: filter.productionDate?.$lte || null
        },
        summary,
        data: productions,
        generatedAt: new Date()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error generating cap production report",
        error: error.message
      });
    }
  }

  async getAvailablePreformTypesForBottle(req, res) {
    try {
      const preforms = await PerformProduction.aggregate([
        {
          $match: {
            type: "preform"
          }
        },
        {
          $addFields: {
            available: {
              $subtract: [
                "$quantityProduced",
                {
                  $add: [
                    { $ifNull: ["$wastageKg", 0] },
                    { $ifNull: ["$usedInBottles", 0] }
                  ]
                }
              ]
            }
          }
        },
        {
          $match: {
            available: { $gt: 0 }
          }
        },
        {
          $project: {
            _id: 0,
            preformTypeId: "$_id",
            type: "$outcomeType",
            totalAvailable: "$available",
            totalProduced: "$quantityProduced",
            totalUsed: { $ifNull: ["$usedInBottles", 0] },
            lastProductionDate: "$productionDate"
          }
        },
        {
          $sort: { type: 1 }
        }
      ]);

      return res.status(200).json({
        success: true,
        data: preforms,
        message: `Found ${preforms.length} preform types with available stock`
      });

    } catch (error) {
      console.error("Error fetching available preform types:", error);
      return res.status(500).json({
        success: false,
        message: "Error fetching available preform types",
        error: error.message
      });
    }
  }

  async getProductionBatchesForSelection(req, res) {
    try {
      const { type, materialType } = req.query;

      if (!materialType) {
        return res.status(400).json({
          success: false,
          message: "materialType is required ('preform' or 'cap')"
        });
      }

      let batches = [];
      let totalAvailable = 0;

      if (materialType === 'preform') {
        let filter = { type: "preform" };
        if (type) filter.outcomeType = type;

        const productions = await PerformProduction.find(filter)
          .sort({ productionDate: 1 });

        batches = productions.map(prod => {
          const available = prod.quantityProduced - (prod.wastage || 0) - (prod.usedInBottles || 0);
          return {
            productionId: prod._id,
            type: prod.outcomeType,
            productionDate: prod.productionDate,
            totalProduced: prod.quantityProduced,
            wastage: prod.wastage || 0,
            used: prod.usedInBottles || 0,
            available: Math.max(0, available),
            remarks: prod.remarks
          };
        }).filter(batch => batch.available > 0);

        totalAvailable = batches.reduce((sum, batch) => sum + batch.available, 0);

      } else if (materialType === 'cap') {
        let filter = {};
        if (type) filter.capType = type;

        const productions = await CapProduction.find(filter)
          .sort({ productionDate: 1 });

        batches = productions.map(prod => {
          const available = prod.quantityProduced - (prod.wastage || 0) - (prod.usedInBottles || 0);
          return {
            productionId: prod._id,
            type: prod.capType,
            productionDate: prod.productionDate,
            totalProduced: prod.quantityProduced,
            wastage: prod.wastage || 0,
            used: prod.usedInBottles || 0,
            available: Math.max(0, available),
            remarks: prod.remarks
          };
        }).filter(batch => batch.available > 0);

        totalAvailable = batches.reduce((sum, batch) => sum + batch.available, 0);
      }

      res.status(200).json({
        success: true,
        data: {
          batches,
          totalAvailable,
          materialType
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error fetching production batches",
        error: error.message
      });
    }
  }

  async recordWastage(req, res) {
    try {
      const {
        source,
        quantityType1,
        quantityType2,
        remarks,
        date
      } = req.body;
      const userId = req.user.id;

      if (!source || (!quantityType1 && !quantityType2)) {
        return res.status(400).json({
          success: false,
          message: "Source and at least one wastage quantity are required"
        });
      }

      const wastageRecords = [];

      if (quantityType1 && quantityType1 > 0) {
        const wastage1 = new Wastage({
          wastageType: "Type 1: Reusable Wastage",
          source,
          quantityGenerated: quantityType1,
          quantityReused: 0,
          remarks: remarks || "",
          date: date ? new Date(date) : new Date(),
          recordedBy: userId,
        });

        await wastage1.save();
        wastageRecords.push(wastage1);
      }

      if (quantityType2 && quantityType2 > 0) {
        const wastage2 = new Wastage({
          wastageType: "Type 2: Non-reusable / Scrap",
          source,
          quantityGenerated: quantityType2,
          quantityReused: 0,
          quantityScrapped: quantityType2,
          remarks: remarks || "",
          date: date ? new Date(date) : new Date(),
          recordedBy: userId,
        });

        await wastage2.save();
        wastageRecords.push(wastage2);
      }

      res.status(201).json({
        success: true,
        data: wastageRecords,
        message: "Wastage recorded successfully"
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async reuseWastage(req, res) {
    try {
      const { wastageId, quantityReused, reuseReference, remarks } = req.body;
      const userId = req.user.id;

      if (!wastageId || !quantityReused) {
        return res.status(400).json({ success: false, message: "Wastage ID and quantity reused are required" });
      }

      const wastage = await Wastage.findById(wastageId);
      if (!wastage) {
        return res.status(404).json({ success: false, message: "Wastage record not found" });
      }

      const totalReused = wastage.quantityReused + quantityReused;

      if (totalReused > wastage.quantityGenerated) {
        return res.status(400).json({
          success: false,
          message: `Cannot reuse more than generated wastage. Generated: ${wastage.quantityGenerated}, Already reused: ${wastage.quantityReused}, Trying to reuse: ${quantityReused}`
        });
      }

      wastage.quantityReused = totalReused;
      wastage.reuseReference = reuseReference || wastage.reuseReference;
      if (remarks) wastage.remarks = remarks;

      await wastage.save();

      res.status(200).json({
        success: true,
        data: wastage,
        message: "Wastage reuse recorded successfully"
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getWastageReport(req, res) {
    try {
      const { startDate, endDate, source, wastageType } = req.query;

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

      res.status(200).json({ success: true, data: wastage });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async recordDirectUsage(req, res) {
    try {
      const { materialId, quantity, purpose, remarks, usageDate } = req.body;
      const userId = req.user.id;

      if (!materialId || !quantity || !purpose) {
        return res.status(400).json({ success: false, message: "Material, quantity and purpose are required" });
      }

      const material = await RawMaterial.findById(materialId);
      if (!material) {
        return res.status(404).json({ success: false, message: "Material not found" });
      }

      if (material.currentStock < quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock. Available: ${material.currentStock}, Required: ${quantity}`
        });
      }

      await RawMaterial.findByIdAndUpdate(
        materialId,
        { $inc: { currentStock: -quantity } }
      );

      const directUsage = new DirectUsage({
        material: materialId,
        quantity,
        purpose,
        remarks,
        usageDate: usageDate ? new Date(usageDate) : new Date(),
        recordedBy: userId,
      });

      await directUsage.save();
      await directUsage.populate("material", "itemName itemCode unit");
      await directUsage.populate("recordedBy", "name");

      res.status(201).json({
        success: true,
        data: directUsage,
        message: "Direct usage recorded successfully"
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getStockReport(req, res) {
    try {
      const materials = await RawMaterial.find({ isActive: true })
        .select("itemName itemCode subcategory unit currentStock minStockLevel")
        .sort({ itemName: 1 });

      res.status(200).json({ success: true, data: materials });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getProductionReport(req, res) {
    try {
      const { startDate, endDate } = req.query;

      let filter = {};

      if (startDate || endDate) {
        filter.productionDate = {};

        if (startDate) {
          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
          filter.productionDate.$gte = start;
        }

        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          filter.productionDate.$lte = end;
        }
      }

      console.log("Production filter:", filter);

      const productions = await PreformProduction.find(filter)
        .populate("rawMaterials.material", "itemName itemCode unit")
        .populate("recordedBy", "name")
        .sort({ productionDate: -1 });

      res.status(200).json({
        success: true,
        count: productions.length,
        data: productions
      });

    } catch (error) {
      console.error("Production report error:", error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async getUsageReport(req, res) {
    try {
      const { startDate, endDate } = req.query;

      let filter = {};

      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        filter.usageDate = {
          $gte: start,
          $lte: end
        };
      }

      const usage = await DirectUsage.find(filter)
        .populate("material", "itemName itemCode unit")
        .populate("recordedBy", "name")
        .sort({ usageDate: -1 });

      res.status(200).json({
        success: true,
        count: usage.length,
        data: usage
      });

    } catch (error) {
      console.error("Usage report error:", error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async addRawMaterialEntry(req, res) {
    try {
      const { rawMaterialId, quantityKg, remarks } = req.body;
      const userId = req.user.id;

      if (!rawMaterialId || !quantityKg || quantityKg <= 0) {
        return res.status(400).json({
          success: false,
          message: "Raw material ID and positive quantity are required"
        });
      }

      const material = await RawMaterial.findById(rawMaterialId);
      if (!material) {
        return res.status(404).json({
          success: false,
          message: "Raw material not found"
        });
      }

      const entry = new RawMaterialEntry({
        rawMaterial: rawMaterialId,
        quantityKg,
        remarks,
        enteredBy: userId,
      });

      await entry.save();

      await RawMaterial.findByIdAndUpdate(
        rawMaterialId,
        { $inc: { currentStock: quantityKg } }
      );

      await entry.populate("rawMaterial", "itemName itemCode unit");
      await entry.populate("enteredBy", "name");

      res.status(201).json({
        success: true,
        data: entry,
        message: "Raw material entry added successfully"
      });
    } catch (error) {
      console.error("Error adding raw material entry:", error);
      res.status(500).json({
        success: false,
        message: "Error adding raw material entry",
        error: error.message
      });
    }
  }

  async getRawMaterials(req, res) {
    try {
      const { search, category, showInactive } = req.query;

      let filter = {};

      if (!showInactive || showInactive === 'false') {
        filter.isActive = true;
      }

      if (search) {
        filter.$or = [
          { itemName: { $regex: search, $options: 'i' } },
          { itemCode: { $regex: search, $options: 'i' } }
        ];
      }

      if (category) {
        filter.subcategory = category;
      }

      const materials = await RawMaterial.find(filter)
        .select("itemName itemCode subcategory unit supplier minStockLevel currentStock isActive createdAt")
        .sort({ itemName: 1 });

      const materialsWithStatus = materials.map(material => ({
        ...material.toObject(),
        stockStatus: material.currentStock <= 0 ? 'OUT_OF_STOCK' :
          material.currentStock <= material.minStockLevel ? 'LOW_STOCK' : 'NORMAL',
        needsReorder: material.currentStock <= material.minStockLevel
      }));

      res.status(200).json({
        success: true,
        data: materialsWithStatus,
        count: materialsWithStatus.length
      });
    } catch (error) {
      console.error("Error fetching raw materials:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching raw materials",
        error: error.message
      });
    }
  }

  async getRawMaterialById(req, res) {
    try {
      const { id } = req.params;

      const material = await RawMaterial.findById(id);
      if (!material) {
        return res.status(404).json({
          success: false,
          message: "Raw material not found"
        });
      }

      const recentEntries = await RawMaterialEntry.find({ rawMaterial: id })
        .populate("enteredBy", "name")
        .sort({ entryDate: -1 })
        .limit(10);

      let usageHistory = [];

      // 1. ProductionOutcome
      const prodOutcomes = await ProductionOutcome.find({
        "rawMaterials.material": id
      }).populate("outcomes.outcomeItem", "itemName itemCode").lean();

      prodOutcomes.forEach(po => {
        const mat = po.rawMaterials.find(rm => String(rm.material) === String(id));
        const usedKg = mat ? mat.quantityUsed : (po.usedRawMaterialKg || 0);
        usageHistory.push({
          _id: po._id,
          type: "Production",
          usedRawMaterialKg: usedKg,
          outcomes: po.outcomes || [],
          productionDate: po.productionDate
        });
      });

      // 2. PreformProduction
      const preformOutcomes = await PreformProduction.find({
        "rawMaterials.material": id
      }).lean();

      preformOutcomes.forEach(pp => {
        const mat = pp.rawMaterials.find(rm => String(rm.material) === String(id));
        const usedKg = mat ? mat.quantityUsed : 0;
        usageHistory.push({
          _id: pp._id,
          type: "Preform",
          usedRawMaterialKg: usedKg,
          outcomes: [{ outcomeItem: { itemName: `Preform (${pp.outcomeType})` } }],
          productionDate: pp.productionDate
        });
      });

      // 3. BottleProduction (only if material is Shrink Roll)
      if (material.itemName && material.itemName.match(/shrink\s*roll/i)) {
        const bottleProds = await BottleProduction.find({
          "details.shrinkRollUsed": { $gt: 0 }
        }).lean();

        bottleProds.forEach(bp => {
          usageHistory.push({
            _id: bp._id,
            type: "Bottle Production",
            usedRawMaterialKg: bp.details.shrinkRollUsed,
            outcomes: bp.producedBottles.map(b => ({ outcomeItem: { itemName: b.bottleName } })),
            productionDate: bp.productionDate
          });
        });
      }

      // Sort and limit
      usageHistory.sort((a, b) => new Date(b.productionDate) - new Date(a.productionDate));
      usageHistory = usageHistory.slice(0, 10);

      const materialWithDetails = {
        ...material.toObject(),
        recentEntries,
        usageHistory,
        stockStatus: material.currentStock <= 0 ? 'OUT_OF_STOCK' :
          material.currentStock <= material.minStockLevel ? 'LOW_STOCK' : 'NORMAL'
      };

      res.status(200).json({
        success: true,
        data: materialWithDetails
      });
    } catch (error) {
      console.error("Error fetching raw material:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching raw material",
        error: error.message
      });
    }
  }

  async updateRawMaterialStock(req, res) {
    try {
      const { id } = req.params;
      const { adjustmentType, quantity, reason, remarks } = req.body;
      const userId = req.user.id;

      if (!adjustmentType || !quantity || quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: "Adjustment type and positive quantity are required"
        });
      }

      const material = await RawMaterial.findById(id);
      if (!material) {
        return res.status(404).json({
          success: false,
          message: "Raw material not found"
        });
      }

      let newStock = material.currentStock;

      if (adjustmentType === 'addition') {
        newStock += quantity;
      } else if (adjustmentType === 'reduction') {
        newStock -= quantity;
        if (newStock < 0) {
          return res.status(400).json({
            success: false,
            message: "Insufficient stock for reduction"
          });
        }
      } else if (adjustmentType === 'set') {
        newStock = quantity;
      } else {
        return res.status(400).json({
          success: false,
          message: "Invalid adjustment type. Use 'addition', 'reduction', or 'set'"
        });
      }
      material.currentStock = newStock;
      await material.save();

      const adjustmentEntry = new RawMaterialEntry({
        rawMaterial: id,
        quantityKg: adjustmentType === 'addition' ? quantity :
          adjustmentType === 'reduction' ? -quantity :
            quantity - material.currentStock,
        remarks: `Manual ${adjustmentType}: ${quantity} ${material.unit}. Reason: ${reason}. ${remarks || ''}`,
        enteredBy: userId,
        isManualAdjustment: true
      });

      await adjustmentEntry.save();

      res.status(200).json({
        success: true,
        data: {
          material: await RawMaterial.findById(id),
          adjustment: adjustmentEntry
        },
        message: `Stock ${adjustmentType} completed successfully`
      });
    } catch (error) {
      console.error("Error updating raw material stock:", error);
      res.status(500).json({
        success: false,
        message: "Error updating raw material stock",
        error: error.message
      });
    }
  }

  async addOutcomeItem(req, res) {
    try {
      const { itemName, itemCode, type, subcategory, remarks } = req.body;
      if (!itemName || !itemCode || !type) {
        return res.status(400).json({ success: false, message: "itemName, itemCode and type are required" });
      }
      const exists = await OutcomeItem.findOne({ itemCode });
      if (exists) {
        return res.status(400).json({ success: false, message: "Outcome item code already exists" });
      }
      const outcome = new OutcomeItem({ itemName, itemCode, type, subcategory, remarks });
      await outcome.save();
      res.status(201).json({ success: true, data: outcome });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getOutcomeItems(req, res) {
    try {
      const outcomes = await OutcomeItem.find({ isActive: true }).select("itemName itemCode type subcategory remarks");
      res.status(200).json({ success: true, data: outcomes });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getRawMaterialEntries(req, res) {
    try {
      const entries = await RawMaterialEntry.find()
        .populate("rawMaterial", "itemName itemCode unit")
        .populate("enteredBy", "name")
        .sort({ entryDate: -1 });
      res.status(200).json({ success: true, data: entries });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async recordProductionOutcome(req, res) {
    try {
      const { rawMaterials, outcomes, wastageKg, remarks, productionDate } = req.body;
      const userId = req.user.id;

      if (!rawMaterials || rawMaterials.length === 0 || !outcomes || outcomes.length === 0 || wastageKg < 0) {
        return res.status(400).json({ success: false, message: "Raw materials and outcomes are required" });
      }

      const usedRawMaterialKg = rawMaterials.reduce((total, rm) => total + rm.quantityUsed, 0);

      for (let rm of rawMaterials) {
        const material = await RawMaterial.findById(rm.materialId || rm.material);
        if (!material) {
          return res.status(404).json({ success: false, message: `Raw material ${rm.materialId} not found` });
        }

        if (material.currentStock < rm.quantityUsed) {
          return res.status(400).json({
            success: false,
            message: `Insufficient stock for ${material.itemName}. Available: ${material.currentStock}, Required: ${rm.quantityUsed}`
          });
        }
      }

      for (let o of outcomes) {
        const outcome = await OutcomeItem.findById(o.outcomeItemId || o.outcomeItem);
        if (!outcome) {
          return res.status(404).json({ success: false, message: `Outcome item ${o.outcomeItemId} not found` });
        }
        if (!o.quantityCreatedKg || o.quantityCreatedKg <= 0) {
          return res.status(400).json({ success: false, message: "Invalid quantity created" });
        }
      }

      for (let rm of rawMaterials) {
        await RawMaterial.findByIdAndUpdate(
          rm.materialId || rm.material,
          { $inc: { currentStock: -rm.quantityUsed } }
        );
      }

      const production = new ProductionOutcome({
        rawMaterials: rawMaterials.map(rm => ({
          material: rm.materialId || rm.material,
          quantityUsed: rm.quantityUsed
        })),
        usedRawMaterialKg,
        outcomes: outcomes.map(o => ({
          outcomeItem: o.outcomeItemId || o.outcomeItem,
          quantityCreatedKg: o.quantityCreatedKg,
        })),
        wastageKg,
        remarks,
        productionDate: productionDate ? new Date(productionDate) : new Date(),
        recordedBy: userId,
      });

      await production.save();

      await production.populate("rawMaterials.material", "itemName itemCode unit");
      await production.populate("outcomes.outcomeItem", "itemName itemCode type");
      await production.populate("recordedBy", "name");

      res.status(201).json({
        success: true,
        data: production,
        message: "Production outcome recorded successfully"
      });
    } catch (error) {
      console.error("Error recording production outcome:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getProductionOutcomes(req, res) {
    try {
      const outcomes = await ProductionOutcome.find()
        .populate("rawMaterials.material", "itemName itemCode unit")
        .populate("outcomes.outcomeItem", "itemName itemCode type")
        .populate("recordedBy", "name")
        .sort({ productionDate: -1 });

      res.status(200).json({ success: true, data: outcomes });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getAvailablePreforms(req, res) {
    try {
      const { type } = req.query;

      let filter = { type: "preform" };
      if (type) {
        filter.outcomeType = type;
      }

      const preformProductions = await PerformProduction.find(filter)
        .populate("rawMaterials.material", "itemName itemCode unit")
        .populate("recordedBy", "name")
        .sort({ productionDate: -1 });

      const preforms = [];
      const typeMap = {};

      preformProductions.forEach(production => {
        const type = production.outcomeType;
        const quantity = production.quantityProduced - (production.wastage || 0);

        if (!typeMap[type]) {
          typeMap[type] = {
            type: type,
            totalProduced: 0,
            totalWastage: 0,
            available: 0,
            productions: []
          };
        }

        typeMap[type].totalProduced += production.quantityProduced;
        typeMap[type].totalWastage += (production.wastage || 0);
        typeMap[type].available += quantity;
        typeMap[type].productions.push(production);
      });

      for (const type in typeMap) {
        preforms.push({
          type: type,
          totalProduced: typeMap[type].totalProduced,
          totalWastage: typeMap[type].totalWastage,
          available: typeMap[type].available,
          recentProductions: typeMap[type].productions.slice(0, 5)
        });
      }

      res.status(200).json({
        success: true,
        data: preforms
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error fetching preforms",
        error: error.message
      });
    }
  }

  async getAvailableCaps(req, res) {
    try {
      const { type } = req.query;

      let filter = {};
      if (type) {
        filter.capType = type;
      }

      const capProductions = await CapProduction.find(filter)
        .populate("rawMaterials.material", "itemName itemCode unit")
        .populate("recordedBy", "name")
        .sort({ productionDate: -1 });

      const caps = [];
      const typeMap = {};

      capProductions.forEach(production => {
        const type = production.capType;
        const quantity = production.quantityProduced - (production.wastage || 0);

        if (!typeMap[type]) {
          typeMap[type] = {
            type: type,
            totalProduced: 0,
            totalWastage: 0,
            available: 0,
            productions: []
          };
        }

        typeMap[type].totalProduced += production.quantityProduced;
        typeMap[type].totalWastage += (production.wastage || 0);
        typeMap[type].available += quantity;
        typeMap[type].productions.push(production);
      });

      for (const type in typeMap) {
        caps.push({
          type: type,
          totalProduced: typeMap[type].totalProduced,
          totalWastage: typeMap[type].totalWastage,
          available: typeMap[type].available,
          recentProductions: typeMap[type].productions.slice(0, 5)
        });
      }

      res.status(200).json({
        success: true,
        data: caps
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error fetching caps",
        error: error.message
      });
    }
  }

  async getPreformTypes(req, res) {
    try {
      const types = await PreformType.find({ isActive: true })
        .select("name description isActive createdAt")
        .sort({ createdAt: -1 })
        .lean();

      const PreformProduction = require("../models/PreformProduction");
      
      const typesWithStock = await Promise.all(types.map(async (type) => {
        const normalizedName = type.name.toLowerCase().trim();
        const productions = await PreformProduction.find({ outcomeType: normalizedName });
        
        let totalAvailableKg = 0;
        productions.forEach(p => {
          const available = p.quantityProduced - (p.usedInBottles || 0);
          totalAvailableKg += Math.max(0, available);
        });

        return {
          ...type,
          totalAvailableKg
        };
      }));

      return res.status(200).json({
        success: true,
        count: typesWithStock.length,
        data: typesWithStock
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async getCapTypes(req, res) {
    try {
      const types = await CapProduction.distinct("capType");
      res.status(200).json({
        success: true,
        data: types
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error fetching cap types",
        error: error.message
      });
    }
  }

  async checkMaterialAvailability(req, res) {
    try {
      const {
        preformTypeId,
        boxes,
        bottlesPerBox,
        bottleCategoryId,
        labelId,
        capId,
        preformUsedKg
      } = req.body;

      if (
        !preformTypeId ||
        !boxes ||
        !bottlesPerBox ||
        !bottleCategoryId ||
        !labelId ||
        !capId ||
        preformUsedKg === undefined
      ) {
        return res.status(400).json({
          success: false,
          message: "All parameters (including preformUsedKg) are required"
        });
      }

      const totalBottles = Number(boxes) * Number(bottlesPerBox);
      const reqPreformUsedKg = Number(preformUsedKg);

      if (!Number.isInteger(totalBottles) || totalBottles <= 0 || reqPreformUsedKg <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid box, bottle calculation, or preform usage"
        });
      }

      // ✅ STEP 1: Get PreformType (MASTER)
      const preformType = await PreformType.findById(preformTypeId);

      if (!preformType || !preformType.isActive) {
        return res.status(404).json({
          success: false,
          message: "Preform type not found"
        });
      }

      // 🔥 STEP 2: Match using name (current DB structure)
      const normalizedPreformType = preformType.name.toLowerCase().trim();

      // ✅ STEP 3: Get ALL productions of this type
      const preformProductions = await PreformProduction.find({
        outcomeType: normalizedPreformType
      }).select("quantityProduced wastageKg usedInBottles outcomeType");

      if (!preformProductions.length) {
        return res.status(404).json({
          success: false,
          message: `No preform stock found for ${preformType.name}`
        });
      }

      // ✅ STEP 4: Calculate total available
      let preformsAvailable = 0;

      preformProductions.forEach(p => {
        const available =
          p.quantityProduced -
          (p.wastageKg || 0) -
          (p.usedInBottles || 0);

        preformsAvailable += Math.max(0, available);
      });

      // ✅ Bottle category
      const bottleProduct = await Product.findById(bottleCategoryId)
        .select("name category");

      if (!bottleProduct) {
        return res.status(404).json({
          success: false,
          message: "Bottle category not found"
        });
      }

      // ✅ Cap
      const cap = await Cap.findById(capId)
        .select("quantityAvailable neckType size color");

      if (!cap) {
        return res.status(404).json({
          success: false,
          message: "Cap not found"
        });
      }

      const capsAvailable = cap.quantityAvailable;

      // ✅ Shrink roll
      const shrinkRollFormula = await Formula.findOne({
        name: "Shrink Roll per Box"
      });

      const shrinkRollPerBox = shrinkRollFormula
        ? Number(shrinkRollFormula.formula)
        : 50;

      const totalShrinkRoll = Number(boxes) * shrinkRollPerBox;

      const shrinkRoll = await RawMaterial.findOne({
        itemCode: "SHRINK_ROLL",
        isActive: true
      }).select("currentStock");

      // ✅ Label
      const label = await Label.findById(labelId)
        .select("quantityAvailable bottleName bottleCategory");

      if (!label) {
        return res.status(404).json({
          success: false,
          message: "Label not found"
        });
      }

      const labelsAvailable = label.quantityAvailable;

      return res.status(200).json({
        success: true,
        data: {
          requirements: {
            bottles: totalBottles,
            preformsKg: reqPreformUsedKg,
            caps: totalBottles,
            shrinkRoll: totalShrinkRoll,
            labels: totalBottles
          },
          availability: {
            preforms: {
              type: preformType.name,
              available: preformsAvailable,
              sufficient: preformsAvailable >= reqPreformUsedKg,
              shortage: Math.max(0, reqPreformUsedKg - preformsAvailable)
            },
            caps: {
              type: `${cap.neckType} ${cap.size || ""} ${cap.color || ""}`.trim(),
              available: capsAvailable,
              sufficient: capsAvailable >= totalBottles,
              shortage: Math.max(0, totalBottles - capsAvailable)
            },
            shrinkRoll: {
              available: shrinkRoll ? shrinkRoll.currentStock : 0,
              required: totalShrinkRoll,
              sufficient: shrinkRoll
                ? shrinkRoll.currentStock >= totalShrinkRoll
                : false,
              unit: "gm"
            },
            labels: {
              name: label.bottleName,
              category: label.bottleCategory,
              available: labelsAvailable,
              required: totalBottles,
              sufficient: labelsAvailable >= totalBottles,
              unit: "nos"
            }
          },
          canProduce:
            preformsAvailable >= totalBottles &&
            capsAvailable >= totalBottles &&
            (shrinkRoll ? shrinkRoll.currentStock >= totalShrinkRoll : false) &&
            labelsAvailable >= totalBottles
        }
      });

    } catch (error) {
      console.error("Error checking material availability:", error);
      return res.status(500).json({
        success: false,
        message: "Error checking material availability",
        error: error.message
      });
    }
  }

  async checkBottleProductionAvailability(req, res) {
    try {
      const { preformType, capType, boxes, bottlesPerBox } = req.query;

      if (!preformType || !capType || !boxes || !bottlesPerBox) {
        return res.status(400).json({
          success: false,
          message: "All parameters are required"
        });
      }

      const totalBottles = boxes * bottlesPerBox;

      // Check preform availability
      const preformProductions = await PerformProduction.find({
        outcomeType: preformType
      });

      let totalPreformsAvailable = 0;
      preformProductions.forEach(prod => {
        const available = prod.quantityProduced - (prod.wastage || 0) - (prod.usedInBottles || 0);
        totalPreformsAvailable += Math.max(0, available);
      });

      // Check cap availability
      const capProductions = await CapProduction.find({
        capType: capType
      });

      let totalCapsAvailable = 0;
      capProductions.forEach(prod => {
        const available = prod.quantityProduced - (prod.wastage || 0) - (prod.usedInBottles || 0);
        totalCapsAvailable += Math.max(0, available);
      });

      // Check packaging materials
      const shrinkRoll = await RawMaterial.findOne({ itemCode: "SHRINK_ROLL", isActive: true });
      const labels = await RawMaterial.findOne({ itemCode: "LABELS", isActive: true });

      const shrinkRollNeeded = boxes * 50;
      const labelsNeeded = totalBottles;

      res.status(200).json({
        success: true,
        data: {
          requirements: {
            bottles: totalBottles,
            preforms: totalBottles,
            caps: totalBottles,
            shrinkRoll: shrinkRollNeeded,
            labels: labelsNeeded
          },
          availability: {
            preforms: {
              type: preformType,
              available: totalPreformsAvailable,
              sufficient: totalPreformsAvailable >= totalBottles,
              shortage: Math.max(0, totalBottles - totalPreformsAvailable)
            },
            caps: {
              type: capType,
              available: totalCapsAvailable,
              sufficient: totalCapsAvailable >= totalBottles,
              shortage: Math.max(0, totalBottles - totalCapsAvailable)
            },
            shrinkRoll: {
              available: shrinkRoll ? shrinkRoll.currentStock : 0,
              required: shrinkRollNeeded,
              sufficient: shrinkRoll ? shrinkRoll.currentStock >= shrinkRollNeeded : false,
              unit: "gm"
            },
            labels: {
              available: labels ? labels.currentStock : 0,
              required: labelsNeeded,
              sufficient: labels ? labels.currentStock >= labelsNeeded : false,
              unit: "nos"
            }
          },
          canProduce: totalPreformsAvailable >= totalBottles &&
            totalCapsAvailable >= totalBottles &&
            (shrinkRoll ? shrinkRoll.currentStock >= shrinkRollNeeded : false) &&
            (labels ? labels.currentStock >= labelsNeeded : false)
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error checking availability",
        error: error.message
      });
    }
  }


  async initializeEssentialMaterials() {
    try {
      const essentialMaterials = [
        {
          itemName: "Shrink Roll",
          itemCode: "SHRINK_ROLL",
          unit: "Gm",
          subcategory: "Packaging",
          minStockLevel: 10000,
          currentStock: 0,
          remarks: "Used for packing bottles into boxes"
        },
        {
          itemName: "Labels",
          itemCode: "LABELS",
          unit: "Nos",
          subcategory: "Packaging",
          minStockLevel: 100000,
          currentStock: 0,
          remarks: "Bottle labels"
        },
        {
          itemName: "Caps",
          itemCode: "CAPS",
          unit: "Nos",
          subcategory: "Packaging",
          minStockLevel: 50000,
          currentStock: 0,
          remarks: "Bottle caps"
        },
        {
          itemName: "Cap Boxes",
          itemCode: "CAP_BOXES",
          unit: "Nos",
          subcategory: "Packaging",
          minStockLevel: 100,
          currentStock: 0,
          remarks: "Boxes for packing caps"
        },
        {
          itemName: "Cap Bags",
          itemCode: "CAP_BAGS",
          unit: "Nos",
          subcategory: "Packaging",
          minStockLevel: 1000,
          currentStock: 0,
          remarks: "Bags for packing caps"
        }
      ];

      for (const material of essentialMaterials) {
        const exists = await RawMaterial.findOne({ itemCode: material.itemCode });
        if (!exists) {
          await RawMaterial.create(material);
          console.log(`Created material: ${material.itemName}`);
        }
      }

      return true;
    } catch (error) {
      console.error("Error initializing materials:", error);
      return false;
    }
  }

  async initializeMaterials(req, res) {
    try {
      const result = await this.initializeEssentialMaterials();
      if (result) {
        res.status(200).json({
          success: true,
          message: "Essential materials initialized successfully"
        });
      } else {
        res.status(500).json({
          success: false,
          message: "Failed to initialize materials"
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async addLabel(req, res) {
    try {
      const { productId, quantityAvailable, remarks } = req.body;
      const userId = req.user.id;

      if (!productId) {
        return res.status(400).json({
          success: false,
          message: "Product is required"
        });
      }

      // 🔥 Get product details
      const product = await Product.findOne({
        _id: productId,
        type: "Bottle",
        isActive: true
      });

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Bottle product not found"
        });
      }

      // 🔥 Check duplicate
      const exists = await Label.findOne({
        product: productId,
        isActive: true
      });

      if (exists) {
        return res.status(400).json({
          success: false,
          message: "Label already exists for this product"
        });
      }

      // 🔥 Auto fill name + category
      const label = new Label({
        product: product._id,
        bottleCategory: product.category,
        bottleName: product.name,
        quantityAvailable: quantityAvailable || 0,
        remarks,
        createdBy: userId
      });

      await label.save();

      res.status(201).json({
        success: true,
        data: label,
        message: "Label added successfully"
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async updateLabelStock(req, res) {
    try {
      const { id } = req.params;
      const { quantityChange, changeType, remarks } = req.body;
      const userId = req.user.id;

      const label = await Label.findById(id);
      if (!label) {
        return res.status(404).json({
          success: false,
          message: "Label not found"
        });
      }

      let newQuantity = label.quantityAvailable;

      if (changeType === 'addition') {
        newQuantity += quantityChange;
      } else if (changeType === 'reduction') {
        newQuantity -= quantityChange;
        if (newQuantity < 0) {
          return res.status(400).json({
            success: false,
            message: "Insufficient label stock"
          });
        }
      } else if (changeType === 'set') {
        newQuantity = quantityChange;
      }

      label.quantityAvailable = newQuantity;
      label.lastUpdatedBy = userId;

      if (remarks) {
        label.remarks = remarks;
      }

      await label.save();

      res.status(200).json({
        success: true,
        data: label,
        message: "Label stock updated successfully"
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async getLabels(req, res) {
    try {
      const { bottleCategory } = req.query;

      let filter = { isActive: true };
      if (bottleCategory) {
        filter.bottleCategory = bottleCategory;
      }

      const labels = await Label.find(filter)
        .populate("createdBy", "name")
        .populate("lastUpdatedBy", "name")
        .sort({ bottleCategory: 1, bottleName: 1 });

      const labelsWithStatus = labels.map(label => ({
        ...label.toObject(),
        displayName: `${label.bottleName} - ${label.bottleCategory} - ${label.quantityAvailable} Nos. available`,
        stockStatus: label.quantityAvailable <= 0 ? 'OUT_OF_STOCK' :
          label.quantityAvailable <= 1000 ? 'LOW_STOCK' : 'NORMAL'
      }));

      res.status(200).json({
        success: true,
        data: labelsWithStatus
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async getLabelHistory(req, res) {
    try {
      const { id } = req.params;
      
      const productions = await BottleProduction.find({
        "producedBottles.labelId": id
      })
      .populate("recordedBy", "name")
      .sort({ productionDate: -1 });

      const history = productions.map(prod => {
        const bottleEntries = prod.producedBottles.filter(b => b.labelId.toString() === id);
        const totalUsed = bottleEntries.reduce((sum, b) => sum + (b.boxesProduced * b.bottlesPerBox), 0);
        return {
          date: prod.productionDate,
          recordedBy: prod.recordedBy?.name || 'N/A',
          quantityUsed: totalUsed,
          remarks: prod.remarks,
          productionId: prod._id,
          type: 'usage'
        };
      });

      res.status(200).json({ success: true, data: history });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async deleteLabel(req, res) {
    try {
      const { id } = req.params;

      const label = await Label.findByIdAndUpdate(
        id,
        { isActive: false },
        { new: true }
      );

      if (!label) {
        return res.status(404).json({
          success: false,
          message: "Label not found"
        });
      }

      res.status(200).json({
        success: true,
        message: "Label deleted successfully"
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }



  async addCap(req, res) {
    try {
      const { neckType, color, quantityAvailable, remarks } = req.body;
      const userId = req.user.id;

      if (!neckType || !color) {
        return res.status(400).json({
          success: false,
          message: "Neck type and color are required"
        });
      }

      // Check if cap already exists
      const exists = await Cap.findOne({
        neckType,
        color,
        isActive: true
      });

      if (exists) {
        return res.status(400).json({
          success: false,
          message: "Cap with this specification already exists"
        });
      }

      const cap = new Cap({
        neckType,
        color,
        quantityAvailable: quantityAvailable || 0,
        remarks,
        createdBy: userId
      });

      await cap.save();

      res.status(201).json({
        success: true,
        data: cap,
        message: "Cap added successfully"
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async updateCapStock(req, res) {
    try {
      const { id } = req.params;
      const { quantityChange, changeType, remarks } = req.body;
      const userId = req.user.id;

      const cap = await Cap.findById(id);
      if (!cap) {
        return res.status(404).json({
          success: false,
          message: "Cap not found"
        });
      }

      let newQuantity = cap.quantityAvailable;

      if (changeType === 'addition') {
        newQuantity += quantityChange;
      } else if (changeType === 'reduction') {
        newQuantity -= quantityChange;
        if (newQuantity < 0) {
          return res.status(400).json({
            success: false,
            message: "Insufficient cap stock"
          });
        }
      } else if (changeType === 'set') {
        newQuantity = quantityChange;
      }

      cap.quantityAvailable = newQuantity;
      cap.lastUpdatedBy = userId;

      if (remarks) {
        cap.remarks = remarks;
      }

      await cap.save();

      res.status(200).json({
        success: true,
        data: cap,
        message: "Cap stock updated successfully"
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async getCaps(req, res) {
    try {
      const { neckType, color } = req.query;

      let filter = { isActive: true };
      if (neckType) filter.neckType = neckType;
      if (color) filter.color = color;

      const caps = await Cap.find(filter)
        .populate("createdBy", "name")
        .populate("lastUpdatedBy", "name")
        .sort({ neckType: 1, color: 1 });

      const capsWithStatus = caps.map(cap => ({
        ...cap.toObject(),
        displayName: `${cap.neckType} - ${cap.color} - ${cap.quantityAvailable} Nos. available`,
        stockStatus: cap.quantityAvailable <= 0 ? 'OUT_OF_STOCK' :
          cap.quantityAvailable <= 3000 ? 'LOW_STOCK' : 'NORMAL'
      }));

      res.status(200).json({
        success: true,
        data: capsWithStatus
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async deleteCap(req, res) {
    try {
      const { id } = req.params;

      const capToProtect = await Cap.findById(id);
      if (capToProtect) {
        const protectedTypes = ['narrow neck', 'short neck', 'alaska 60', 'shortneck'];
        if (protectedTypes.includes(capToProtect.neckType.toLowerCase())) {
          return res.status(400).json({
            success: false,
            message: "Default Cap types (Narrow Neck, Short Neck, Alaska 60) cannot be deleted."
          });
        }
      }

      const cap = await Cap.findByIdAndUpdate(
        id,
        { isActive: false },
        { new: true }
      );

      if (!cap) {
        return res.status(404).json({
          success: false,
          message: "Cap not found"
        });
      }

      res.status(200).json({
        success: true,
        message: "Cap deleted successfully"
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = new StockController();
