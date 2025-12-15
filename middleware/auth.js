// Authentication middleware for verifying Firebase ID tokens
const { admin } = require('../configs/firebase');

/**
 * Middleware to verify Firebase ID token from Authorization header
 * Sets req.user with uid and email if valid
 */
const verifyAuth = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false,
        message: 'Authentication required. Please provide a valid token.' 
      });
    }
    
    // Extract token
    const idToken = authHeader.split('Bearer ')[1];
    
    if (!idToken) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid token format' 
      });
    }
    
    // Verify token with Firebase Admin
    if (!admin) {
      console.error('Firebase Admin not initialized');
      return res.status(503).json({ 
        success: false,
        message: 'Authentication service unavailable' 
      });
    }
    
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Attach user info to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified || false
    };
    
    next();
  } catch (error) {
    console.error('Auth verification error:', error.message);
    
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ 
        success: false,
        message: 'Token has expired. Please sign in again.' 
      });
    }
    
    if (error.code === 'auth/argument-error') {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid token format' 
      });
    }
    
    return res.status(401).json({ 
      success: false,
      message: 'Invalid or expired token' 
    });
  }
};

/**
 * Middleware to verify user owns the resource (userId matches)
 * Must be used after verifyAuth
 */
const verifyOwnership = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      success: false,
      message: 'Authentication required' 
    });
  }
  
  const { userId } = req.params;
  
  if (!userId) {
    return res.status(400).json({ 
      success: false,
      message: 'User ID is required' 
    });
  }
  
  // Verify user owns the resource
  if (req.user.uid !== userId) {
    console.warn(`Unauthorized access attempt: ${req.user.uid} tried to access ${userId}'s resource`);
    return res.status(403).json({ 
      success: false,
      message: 'Unauthorized: You can only access your own resources' 
    });
  }
  
  next();
};

module.exports = { verifyAuth, verifyOwnership };

