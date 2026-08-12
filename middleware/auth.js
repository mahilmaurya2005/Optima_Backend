const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization').replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ _id: decoded.userId, isActive: true });

    if (!user) {
      throw new Error();
    }

    req.token = token;
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Please authenticate.' });
  }
};


const checkRole = (...roles) => {
    return (req, res, next) => {
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      next();
    };
  };

  // const authWithReception = async (req, res, next) => {
  //   try {
  //     const token = req.header('Authorization')?.replace('Bearer ', '');
      
  //     if (!token) {
  //       throw new Error('No token provided');
  //     }
  
  //     // Verify token
  //     const decoded = jwt.verify(token, process.env.JWT_SECRET);
  
  //     if (!decoded.isReceptionAccess || !decoded.customerId || !decoded.userId) {
  //       throw new Error('Invalid reception access token');
  //     }
  
  //     // Get both reception user and customer user
  //     const [receptionUser, customerUser] = await Promise.all([
  //       User.findOne({ 
  //         _id: decoded.userId, 
  //         role: 'reception',
  //         isActive: true 
  //       }),
  //       User.findOne({ 
  //         _id: decoded.customerId,
  //         role: 'user',
  //         isActive: true 
  //       })
  //     ]);
  
  //     if (!receptionUser || !customerUser) {
  //       throw new Error('Invalid users');
  //     }
  
  //     // Attach users and token info to request
  //     req.user = receptionUser;
  //     req.customerUser = customerUser;
  //     req.isReceptionAccess = true;
  //     req.token = token;
  
  //     next();
  //   } catch (error) {
  //     console.error('Reception auth error:', error);
  //     res.status(401).json({ 
  //       error: 'Authentication failed',
  //       details: error.message 
  //     });
  //   }
  // };

  const authWithReception = async (req, res, next) => {
    try {
      const token = req.header('Authorization')?.replace('Bearer ', '');
      
      if (!token) {
        throw new Error('No token provided');
      }
  
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
  
      if (!decoded.isReceptionAccess || !decoded.customerId || !decoded.userId) {
        throw new Error('Invalid reception access token');
      }
  
      // Get both reception user and customer user
      const [receptionUser, customerUser] = await Promise.all([
        User.findOne({ 
          _id: decoded.userId, 
          role: 'reception',
          isActive: true 
        }),
        User.findOne({ 
          _id: decoded.customerId,
          isActive: true 
        }) // Remove role restriction to allow miscellaneous users
      ]);
  
      if (!receptionUser || !customerUser) {
        throw new Error('Invalid users');
      }
  
      // Attach users and token info to request
      req.user = receptionUser;
      req.customerUser = customerUser;
      req.isReceptionAccess = true;
      req.isMiscellaneous = decoded.isMiscellaneous;
      req.token = token;
  
      next();
    } catch (error) {
      console.error('Reception auth error:', error);
      res.status(401).json({ 
        error: 'Authentication failed',
        details: error.message 
      });
    }
  };
  
  
  module.exports = { auth, checkRole, authWithReception};