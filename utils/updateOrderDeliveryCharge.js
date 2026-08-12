const Challan = require("../models/Challan");
const Order = require("../models/Order");
const roundAmount = require("./roundAmount");

const updateOrderDeliveryCharge = async (orderId) => {
  try {

    const challans = await Challan.find({ originalOrder: orderId });

    const totalDeliveryCharge = challans.reduce(
      (sum, challan) => sum + Number(challan.deliveryCharge || 0),
      0
    );

    const order = await Order.findById(orderId);

    if (!order) return null;

    const totalAmount = Number(order.totalAmount || 0);

    order.deliveryCharge = totalDeliveryCharge;
    order.totalAmountWithDelivery = roundAmount(
      totalAmount + totalDeliveryCharge
    );

    await order.save();

    return order;

  } catch (error) {
    console.error("Error updating order delivery charge:", error);
  }
};

module.exports = updateOrderDeliveryCharge;
