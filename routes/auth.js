const express = require("express");
const router = express.Router();
const { admin, db } = require("../configs/firebase");
require('dotenv').config();

// GET /api/auth/test-firebase
// Test Firebase connection and write/read operations
router.get("/test-firebase", async (req, res) => {
  try {
    console.log("🧪 Testing Firebase connection...");
    
    if (!db) {
      console.error("❌ Firebase database not initialized");
      return res.json({ 
        success: false, 
        error: "Firebase database not initialized. Check environment variables.",
        envCheck: {
          projectId: !!process.env.FIREBASE_PROJECT_ID,
          privateKey: !!process.env.FIREBASE_PRIVATE_KEY ? "Set (length: " + process.env.FIREBASE_PRIVATE_KEY.length + ")" : "Missing",
          clientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
          databaseURL: process.env.FIREBASE_DATABASE_URL || "Missing",
        }
      });
    }
    
    // Get database URL for diagnostics
    const databaseURL = process.env.FIREBASE_DATABASE_URL || "Not set";
    console.log("📋 Database URL:", databaseURL);
    console.log("📋 Database URL format check:", {
      hasProtocol: databaseURL.startsWith("https://"),
      hasTrailingSlash: databaseURL.endsWith("/"),
      length: databaseURL.length
    });
    
    // Check if database URL format is correct
    if (!databaseURL.startsWith("https://") || databaseURL.endsWith("/")) {
      return res.json({
        success: false,
        error: "Database URL format issue",
        details: "Database URL should start with 'https://' and NOT end with '/'",
        currentURL: databaseURL,
        expectedFormat: "https://your-project-default-rtdb.firebaseio.com"
      });
    }
    
    console.log("✅ Firebase database is initialized, testing write/read...");
    
    // Try to get root reference first to verify connection
    console.log("🔍 Testing root reference access...");
    const rootRef = db.ref();
    const rootTestStart = Date.now();
    
    try {
      // Try to read root with a short timeout
      const rootPromise = rootRef.once("value");
      const rootTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Root read timeout")), 3000);
      });
      
      await Promise.race([rootPromise, rootTimeout]);
      console.log(`✅ Root reference accessible (took ${Date.now() - rootTestStart}ms)`);
    } catch (rootError) {
      console.warn("⚠️ Root reference test failed:", rootError.message);
      // Continue anyway - might still work for writes
    }
    
    const testRef = db.ref("test/connection");
    const testData = { 
      timestamp: Date.now(),
      message: "Firebase connection test",
      server: "Render",
      testId: Math.random().toString(36).substring(7)
    };
    
    console.log("💾 Attempting write to: test/connection");
    console.log("💾 Data:", testData);
    
    // Test write with timeout (10 seconds - increased)
    const writeStartTime = Date.now();
    const writePromise = new Promise((resolve, reject) => {
      // Add connection state listener for diagnostics
      const connectionRef = db.ref(".info/connected");
      connectionRef.once("value", (snapshot) => {
        console.log("🔌 Firebase connection state:", snapshot.val());
      });
      
      testRef.set(testData, (error) => {
        if (error) {
          console.error("❌ Firebase write error:", error);
          console.error("❌ Error code:", error.code);
          console.error("❌ Error message:", error.message);
          console.error("❌ Error details:", JSON.stringify(error, null, 2));
          reject(error);
        } else {
          const elapsed = Date.now() - writeStartTime;
          console.log(`✅ Firebase write completed (took ${elapsed}ms)`);
          resolve();
        }
      });
    });
    
    let writeTimeoutId;
    const writeTimeoutPromise = new Promise((_, reject) => {
      writeTimeoutId = setTimeout(() => {
        const elapsed = Date.now() - writeStartTime;
        console.error(`⏱️ Write operation timed out after ${elapsed}ms`);
        reject(new Error(`Write operation timed out after 10 seconds. This usually means: 1) Database rules are blocking writes, 2) Network connectivity issue from Render to Firebase, 3) Database URL is incorrect, or 4) Firebase project is not accessible.`));
      }, 10000); // Increased to 10 seconds
    });
    
    try {
      await Promise.race([writePromise, writeTimeoutPromise]);
      clearTimeout(writeTimeoutId);
    } catch (writeError) {
      clearTimeout(writeTimeoutId);
      // Provide more detailed error information
      return res.json({
        success: false,
        error: writeError.message,
        name: writeError.name,
        diagnostics: {
          databaseURL: databaseURL,
          databaseURLFormat: databaseURL.startsWith("https://") && !databaseURL.endsWith("/") ? "✅ Correct" : "❌ Incorrect",
          projectId: process.env.FIREBASE_PROJECT_ID || "Missing",
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "Missing",
          privateKeySet: !!process.env.FIREBASE_PRIVATE_KEY,
          suggestions: [
            "1. Verify Firebase database rules allow Admin SDK writes (should be .read: false, .write: false)",
            "2. Check that FIREBASE_DATABASE_URL is correct and matches your Firebase project",
            "3. Verify the database exists in Firebase Console",
            "4. Check Render network connectivity to Firebase servers",
            "5. Ensure FIREBASE_PRIVATE_KEY has proper newline characters (\\n)"
          ]
        }
      });
    }
    
    // Wait a bit for write to propagate
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Test read with timeout (10 seconds - increased)
    const readStartTime = Date.now();
    const readPromise = testRef.once("value");
    let readTimeoutId;
    const readTimeoutPromise = new Promise((_, reject) => {
      readTimeoutId = setTimeout(() => {
        reject(new Error("Read operation timed out after 10 seconds"));
      }, 10000);
    });
    
    let snapshot;
    try {
      snapshot = await Promise.race([readPromise, readTimeoutPromise]);
      clearTimeout(readTimeoutId);
      console.log(`✅ Firebase read completed (took ${Date.now() - readStartTime}ms)`);
    } catch (readError) {
      clearTimeout(readTimeoutId);
      // If read fails but write succeeded, still return partial success
      console.warn("⚠️ Read failed but write may have succeeded:", readError.message);
      return res.json({
        success: true,
        warning: "Write succeeded but read verification failed",
        message: "Data may have been saved, but verification read timed out",
        writtenData: testData,
        readError: readError.message
      });
    }
    
    const readData = snapshot.val();
    
    if (readData && readData.timestamp === testData.timestamp) {
      console.log("✅ Firebase connection test PASSED");
      return res.json({ 
        success: true, 
        data: readData,
        message: "Firebase connection working! Write and read operations successful.",
        timings: {
          write: Date.now() - writeStartTime,
          read: Date.now() - readStartTime,
          total: Date.now() - writeStartTime
        }
      });
    } else {
      console.warn("⚠️ Firebase read returned unexpected data");
      return res.json({ 
        success: false, 
        error: "Read data doesn't match written data",
        written: testData,
        read: readData
      });
    }
  } catch (error) {
    console.error("❌ Firebase connection test FAILED:", error);
    return res.json({ 
      success: false, 
      error: error.message,
      code: error.code,
      name: error.name,
      message: "Firebase connection test failed. Check database rules, network, and credentials."
    });
  }
});

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

