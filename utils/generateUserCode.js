const Counter = require("../models/Counter");

const generateUserCode = async () => {
  const counter = await Counter.findOneAndUpdate(
    { name: "userCode" },        
    { $inc: { seq: 1 } },        
    { new: true, upsert: true }  
  );

  const padded = String(counter.seq).padStart(6, "0");

  return `USER-${padded}`;
};

module.exports = generateUserCode;