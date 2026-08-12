const Cart = require("../models/Cart");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const mongoose = require("mongoose");

const cartController = {
  addToCart: async (req, res) => {
    try {
      const { product: productId, boxes: boxesStr } = req.body;
      const userId = req.user._id;

      if (!productId || !boxesStr) {
        return res.status(400).json({ error: "Product ID and boxes are required" });
      }

      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ error: "Invalid product ID format" });
      }

      const boxes = parseInt(boxesStr, 10);
      if (isNaN(boxes) || boxes <= 0) {
        return res.status(400).json({
          error: "Boxes must be a positive number",
        });
      }

      const product = await Product.findById(productId);
      if (!product || !product.isActive) {
        return res.status(404).json({ error: "Product not found or inactive" });
      }

      const now = new Date();
      const isOfferValid =
        product.discountedPrice != null &&
        product.validFrom &&
        product.validTo &&
        now >= new Date(product.validFrom) &&
        now <= new Date(product.validTo);
      const price = isOfferValid ? product.discountedPrice : product.originalPrice;

      let cart = await Cart.findOne({ user: userId });
      if (!cart) {
        cart = new Cart({ user: userId, products: [] });
      }

      cart.products = cart.products.filter(item => item.product && item.boxes > 0);

      const existingIndex = cart.products.findIndex(
        item => item.product.toString() === productId
      );

      if (existingIndex !== -1) {
        cart.products[existingIndex].boxes += boxes;
      } else {
        cart.products.push({ product: productId, boxes });
      }

      await cart.save();

      const populatedCart = await Cart.findById(cart._id).populate("products.product");
      const formattedCart = formatCartResponse(populatedCart, now);

      res.status(200).json({ cart: formattedCart });
    } catch (error) {
      console.error("Add to cart error:", error);
      res.status(500).json({ error: "Error adding to cart", details: error.message });
    }
  },

  getCart: async (req, res) => {
    try {
      const cart = await Cart.findOne({ user: req.user._id })
        .populate("products.product");

      // ✅ Empty cart
      if (!cart || cart.products.length === 0) {
        return res.json({
          cart: {
            products: [],
            totalItems: 0,
            amount: 0,
            gst: 0,
            totalAmount: 0,
          },
        });
      }

      const now = new Date();

      let totalItems = 0;
      let amount = 0;

      const products = cart.products.map((item) => {
        const product = item.product;

        if (!product) return null;

        // ✅ Offer logic
        const isOfferValid =
          product.discountedPrice != null &&
          product.validFrom &&
          product.validTo &&
          now >= new Date(product.validFrom) &&
          now <= new Date(product.validTo);

        const price = isOfferValid
          ? product.discountedPrice
          : product.originalPrice;

        const total = price * item.boxes;

        totalItems += item.boxes;
        amount += total;

        return {
          product: {
            _id: product._id,
            name: product.name,
            type: product.type,
            category: product.category, // 🔥 ADDED
            image: product.image,
            price,
          },
          boxes: item.boxes,
          price,
          total,
        };
      }).filter(Boolean); // remove nulls if any

      const gst = Number((amount * 0.05).toFixed(2));
      const totalAmount = Number((amount + gst).toFixed(2));

      res.json({
        cart: {
          products,
          totalItems,
          amount,
          gst,
          totalAmount,
        },
      });

    } catch (error) {
      console.error("Cart Error:", error);
      res.status(500).json({ error: "Error fetching cart" });
    }
  },

  removeFromCart: async (req, res) => {
    try {
      const { product: productId } = req.body;
      const userId = req.user._id;

      if (!productId) return res.status(400).json({ error: "Product ID required" });

      const cart = await Cart.findOne({ user: userId });
      if (!cart) return res.status(404).json({ error: "Cart not found" });

      cart.products = cart.products.filter(item => item.product.toString() !== productId);
      await cart.save();

      const populatedCart = await Cart.findById(cart._id).populate("products.product");
      const formattedCart = formatCartResponse(populatedCart);

      res.json({ cart: formattedCart });
    } catch (error) {
      res.status(500).json({ error: "Error removing from cart" });
    }
  },
};

function formatCartResponse(cart, now = new Date()) {
  if (!cart) return { products: [], total: 0 };

  const products = cart.products
    .filter(item => item.product)
    .map(item => {
      const product = item.product;
      const isOfferValid =
        product.discountedPrice != null &&
        product.validFrom &&
        product.validTo &&
        now >= new Date(product.validFrom) &&
        now <= new Date(product.validTo);
      const price = isOfferValid ? product.discountedPrice : product.originalPrice;

      return {
        product: {
          _id: product._id,
          name: product.name,
          price,
          category: product.category,
          ...(isOfferValid && {
            discountedPrice: product.discountedPrice,
            discountPercentage: Math.round(
              ((product.originalPrice - product.discountedPrice) / product.originalPrice) * 100
            ),
            discountTag: `${Math.round(
              ((product.originalPrice - product.discountedPrice) / product.originalPrice) * 100
            )}% OFF`,
            offerEndsIn: product.validTo,
          }),
          originalPrice: product.originalPrice,
          image: product.image,
          bottlesPerBox: product.bottlesPerBox,
        },
        boxes: item.boxes,
        subtotal: price * item.boxes,
      };
    });

  const total = products.reduce((sum, item) => sum + item.subtotal, 0);

  return { _id: cart._id, user: cart.user, products, total };
}

module.exports = cartController;
