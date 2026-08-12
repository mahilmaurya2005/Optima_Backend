const cron = require("node-cron");
const Order = require("../models/Order");

const updateOldPendingOrders = async () => {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

  try {
    const result = await Order.updateMany(
      {
        orderStatus: "pending",
        createdAt: { $lte: sixHoursAgo },
      },
      {
        $set: { orderStatus: "preview" },
      }
    );

    console.log(
      `Updated ${result.modifiedCount} old pending orders to preview status`
    );
  } catch (error) {
    console.error("Error updating old pending orders:", error);
  }
};

const initCronJobs = () => {
  cron.schedule("0 * * * *", updateOldPendingOrders);
  console.log("Cron job scheduled: Check for old pending orders every hour");
};

module.exports = initCronJobs;
