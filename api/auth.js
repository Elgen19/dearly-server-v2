const express = require("express");
const router = express.Router();
const { admin, db } = require("../configs/firebase");
require('dotenv').config();

// GET /api/auth/check-verification/:userId
// Check if user's email is verified
router.get("/check-verification/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        error: "User ID is required" 
      });
    }

    if (!db) {
      return res.status(500).json({ 
        success: false, 
        error: "Database not available" 
      });
    }

    // Check user's verification status in Firebase Realtime Database
    const userRef = db.ref(`users/${userId}`);
    const snapshot = await userRef.once('value');
    const userData = snapshot.val();

    if (!userData) {
      return res.status(404).json({ 
        success: false, 
        error: "User not found" 
      });
    }

    res.status(200).json({ 
      success: true, 
      emailVerified: userData.emailVerified || false,
      user: {
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName
      }
    });
  } catch (error) {
    console.error("Check verification error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to check verification status", 
      details: error.message 
    });
  }
});

// POST /api/auth/save-google-user
// Save or update user data when signing in with Google
router.post("/save-google-user", async (req, res) => {
  try {
    const { userId, email, displayName } = req.body;

    console.log('📥 POST /api/auth/save-google-user', { userId, email, displayName });

    if (!userId || !email) {
      console.log('❌ Missing required fields:', { userId: !!userId, email: !!email });
      return res.status(400).json({ 
        success: false, 
        error: "User ID and email are required" 
      });
    }

    if (!db) {
      console.error('❌ Firebase database not initialized');
      return res.status(500).json({ 
        success: false, 
        error: "Database not available" 
      });
    }

    // Parse displayName to extract firstName and lastName
    let firstName = '';
    let lastName = '';
    if (displayName && displayName.trim()) {
      const nameParts = displayName.trim().split(/\s+/);
      firstName = nameParts[0] || '';
      lastName = nameParts.slice(1).join(' ') || '';
    } else {
      // If no displayName, try to extract from email
      const emailParts = email.split('@')[0];
      firstName = emailParts || '';
      lastName = '';
    }

    console.log('📝 Parsed name:', { firstName, lastName });

    const userRef = db.ref(`users/${userId}`);
    const snapshot = await userRef.once('value');
    const existingUser = snapshot.val();

    console.log('👤 Existing user check:', existingUser ? 'User exists' : 'New user');

    const now = new Date().toISOString();

    if (existingUser) {
      // User exists - update updatedAt timestamp
      const updateData = {
        updatedAt: now,
        emailVerified: true, // Google sign-in verifies email
      };
      
      // Only update verifiedAt if it wasn't set before
      if (!existingUser.verifiedAt) {
        updateData.verifiedAt = now;
      }

      // Update firstName and lastName if they're missing or empty
      if (!existingUser.firstName || !existingUser.firstName.trim()) {
        updateData.firstName = firstName;
      }
      if (!existingUser.lastName || !existingUser.lastName.trim()) {
        updateData.lastName = lastName;
      }

      await userRef.update(updateData);
      console.log(`✅ Updated Google user data for ${userId}:`, updateData);
    } else {
      // New user - create user record
      const userData = {
        email: email.trim().toLowerCase(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        emailVerified: true, // Google sign-in automatically verifies email
        createdAt: now,
        updatedAt: now,
        verifiedAt: now // Google sign-in verifies email immediately
      };
      
      await userRef.set(userData);
      console.log(`✅ Created new Google user record for ${userId}:`, userData);
    }

    res.status(200).json({ 
      success: true,
      message: existingUser ? "User data updated" : "User data created"
    });
  } catch (error) {
    console.error("❌ Save Google user error:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({ 
      success: false, 
      error: "Failed to save user data", 
      details: error.message 
    });
  }
});

// GET /api/auth/user/:userId
// Get user profile data
// Security: Require authentication to view user profiles
router.get("/user/:userId", async (req, res) => {
  // In production, require authentication
  if (process.env.NODE_ENV === 'production') {
    const { verifyAuth, verifyOwnership } = require("../middleware/auth");
    // Apply auth middleware
    return verifyAuth(req, res, () => {
      verifyOwnership(req, res, async () => {
        // Continue with original handler logic
        try {
          const { userId } = req.params;

          if (!userId) {
            return res.status(400).json({ 
              success: false, 
              error: "User ID is required" 
            });
          }

          if (!db) {
            return res.status(500).json({ 
              success: false, 
              error: "Database not available" 
            });
          }

          const userRef = db.ref(`users/${userId}`);
          const snapshot = await userRef.once('value');
          const userData = snapshot.val();

          if (!userData) {
            return res.status(404).json({ 
              success: false, 
              error: "User not found" 
            });
          }

          res.status(200).json({ 
            success: true,
            data: {
              email: userData.email,
              firstName: userData.firstName || '',
              lastName: userData.lastName || '',
              emailVerified: userData.emailVerified || false,
              createdAt: userData.createdAt,
              updatedAt: userData.updatedAt
            }
          });
        } catch (error) {
          console.error("Get user profile error:", error);
          res.status(500).json({ 
            success: false, 
            error: "Failed to get user profile",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
          });
        }
      });
    });
  }
  
  // Development mode - original handler
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        error: "User ID is required" 
      });
    }

    if (!db) {
      return res.status(500).json({ 
        success: false, 
        error: "Database not available" 
      });
    }

    const userRef = db.ref(`users/${userId}`);
    const snapshot = await userRef.once('value');
    const userData = snapshot.val();

    if (!userData) {
      return res.status(404).json({ 
        success: false, 
        error: "User not found" 
      });
    }

    res.status(200).json({ 
      success: true,
      data: {
        email: userData.email,
        firstName: userData.firstName || '',
        lastName: userData.lastName || '',
        emailVerified: userData.emailVerified || false,
        createdAt: userData.createdAt,
        updatedAt: userData.updatedAt
      }
    });
  } catch (error) {
    console.error("Get user profile error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to get user profile", 
      details: error.message 
    });
  }
});

// PUT /api/auth/user/:userId
// Update user profile data
// Security: Require authentication to update user profiles
router.put("/user/:userId", async (req, res) => {
  // In production, require authentication
  if (process.env.NODE_ENV === 'production') {
    const { verifyAuth, verifyOwnership } = require("../middleware/auth");
    // Apply auth middleware
    return verifyAuth(req, res, () => {
      verifyOwnership(req, res, async () => {
        // Continue with original handler logic
        try {
          const { userId } = req.params;
          const { firstName, lastName } = req.body;

          if (!userId) {
            return res.status(400).json({ 
              success: false, 
              error: "User ID is required" 
            });
          }

          if (!db) {
            return res.status(500).json({ 
              success: false, 
              error: "Database not available" 
            });
          }

          const userRef = db.ref(`users/${userId}`);
          const snapshot = await userRef.once('value');
          const existingUser = snapshot.val();

          if (!existingUser) {
            return res.status(404).json({ 
              success: false, 
              error: "User not found" 
            });
          }

          const updateData = {
            updatedAt: new Date().toISOString(),
          };

          if (firstName !== undefined) {
            updateData.firstName = firstName.trim();
          }

          if (lastName !== undefined) {
            updateData.lastName = lastName.trim();
          }

          await userRef.update(updateData);

          // Get updated user data
          const updatedSnapshot = await userRef.once('value');
          const updatedUser = updatedSnapshot.val();

          res.status(200).json({ 
            success: true,
            data: {
              email: updatedUser.email,
              firstName: updatedUser.firstName || '',
              lastName: updatedUser.lastName || '',
              emailVerified: updatedUser.emailVerified || false,
              createdAt: updatedUser.createdAt,
              updatedAt: updatedUser.updatedAt
            },
            message: "User profile updated successfully"
          });
        } catch (error) {
          console.error("Update user profile error:", error);
          res.status(500).json({ 
            success: false, 
            error: "Failed to update user profile",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
          });
        }
      });
    });
  }
  
  // Development mode - original handler
  try {
    const { userId } = req.params;
    const { firstName, lastName } = req.body;

    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        error: "User ID is required" 
      });
    }

    if (!db) {
      return res.status(500).json({ 
        success: false, 
        error: "Database not available" 
      });
    }

    const userRef = db.ref(`users/${userId}`);
    const snapshot = await userRef.once('value');
    const existingUser = snapshot.val();

    if (!existingUser) {
      return res.status(404).json({ 
        success: false, 
        error: "User not found" 
      });
    }

    const updateData = {
      updatedAt: new Date().toISOString(),
    };

    if (firstName !== undefined) {
      updateData.firstName = firstName.trim();
    }

    if (lastName !== undefined) {
      updateData.lastName = lastName.trim();
    }

    await userRef.update(updateData);

    // Get updated user data
    const updatedSnapshot = await userRef.once('value');
    const updatedUser = updatedSnapshot.val();

    res.status(200).json({ 
      success: true,
      data: {
        email: updatedUser.email,
        firstName: updatedUser.firstName || '',
        lastName: updatedUser.lastName || '',
        emailVerified: updatedUser.emailVerified || false,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt
      },
      message: "User profile updated successfully"
    });
  } catch (error) {
    console.error("Update user profile error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to update user profile", 
      details: error.message 
    });
  }
});

module.exports = router;

