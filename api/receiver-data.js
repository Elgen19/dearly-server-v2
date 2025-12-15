// API endpoint for managing receiver data (name and email)
const express = require("express");
const router = express.Router();
const { db } = require("../configs/firebase");

// Helper function to execute Firebase operation with timeout and retry
async function firebaseOperationWithTimeout(firebaseOperation, operationName, timeoutMs = 5000, maxRetries = 1) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`🔄 Retrying ${operationName} (attempt ${attempt + 1}/${maxRetries + 1})...`);
      // Wait a bit before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
    
    let timeoutId;
    let operationCompleted = false;
    
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        if (!operationCompleted) {
          operationCompleted = true;
          reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
    });
    
    try {
      const result = await Promise.race([
        firebaseOperation().then((result) => {
          operationCompleted = true;
          clearTimeout(timeoutId);
          return result;
        }).catch((error) => {
          operationCompleted = true;
          clearTimeout(timeoutId);
          throw error;
        }),
        timeoutPromise
      ]);
      
      return result;
    } catch (error) {
      lastError = error;
      // Don't retry on timeout - it's unlikely to succeed
      if (error.message.includes('timed out')) {
        break;
      }
      // Retry on other errors
      console.warn(`⚠️ ${operationName} failed (attempt ${attempt + 1}):`, error.message);
    }
  }
  
  throw lastError;
}

// Get receiver data for a user
router.get("/:userId", async (req, res) => {
  const startTime = Date.now();
  console.log(`📥 GET /api/receiver-data/${req.params.userId} - Request received`);
  
  try {
    const { userId } = req.params;
    console.log(`🔍 Checking Firebase database initialization...`);

    if (!db) {
      console.error('❌ Firebase database is not initialized');
      return res.status(500).json({
        success: false,
        error: "Firebase database not initialized",
      });
    }

    console.log(`✅ Firebase database is initialized, fetching data for user: ${userId}`);
    const receiverRef = db.ref(`users/${userId}/receiver`);
    
    console.log(`⏳ Waiting for Firebase snapshot...`);
    console.log(`🔍 Firebase ref path: users/${userId}/receiver`);
    
    let snapshot;
    try {
      // Try without timeout wrapper first to see if it's a timeout issue
      const firebaseStartTime = Date.now();
      console.log(`⏱️ Starting Firebase operation at ${new Date().toISOString()}`);
      
      snapshot = await firebaseOperationWithTimeout(
        () => {
          console.log(`📡 Executing Firebase .once("value") operation...`);
          return receiverRef.once("value");
        },
        `Firebase read for user ${userId}`,
        8000, // Increase timeout to 8 seconds to see if it's just slow
        0 // No retries for read operations
      );
      
      const firebaseDuration = Date.now() - firebaseStartTime;
      console.log(`✅ Firebase snapshot received (took ${firebaseDuration}ms)`);
    } catch (operationError) {
      // If Firebase operation fails or times out, return null data instead of error
      // This allows the app to continue (user will be treated as new user)
      const errorMessage = operationError.message || 'Unknown error';
      console.warn(`⚠️ Firebase operation failed, returning null data to allow app to continue:`, errorMessage);
      if (operationError.code) {
        console.warn(`⚠️ Firebase error code: ${operationError.code}`);
      }
      
      // Log connectivity issue warning (only once per operation type to avoid spam)
      if (errorMessage.includes('timed out')) {
        console.warn(`⚠️ CONNECTIVITY ISSUE: Firebase Realtime Database operations are timing out.`);
        console.warn(`   This is likely a network/firewall or configuration issue, not a code problem.`);
        console.warn(`   Check Firebase Console, service account permissions, and network connectivity.`);
      }
      
      return res.json({
        success: true,
        data: null,
        message: "No receiver data found (database connection issue)",
      });
    }
    
    const receiverData = snapshot.val();

    if (!receiverData) {
      console.log(`ℹ️ No receiver data found for user: ${userId}`);
      return res.json({
        success: true,
        data: null,
        message: "No receiver data found",
      });
    }

    console.log(`✅ Returning receiver data for user: ${userId} (took ${Date.now() - startTime}ms total)`);
    return res.json({
      success: true,
      data: receiverData,
    });
  } catch (error) {
    console.error(`❌ Unexpected error fetching receiver data (took ${Date.now() - startTime}ms):`, error);
    console.error("Error stack:", error.stack);
    
    // Return null data instead of error to allow app to continue
    // The frontend will treat this as a new user
    return res.json({
      success: true,
      data: null,
      message: "Database connection issue - treating as new user",
    });
  }
});

// Save receiver data for a user
router.post("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, email } = req.body;

    console.log(`📥 POST /api/receiver-data/${userId}`, { name, email });

    if (!name || !email) {
      console.log('❌ Missing required fields');
      return res.status(400).json({
        success: false,
        error: "Name and email are required",
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.log('❌ Invalid email format');
      return res.status(400).json({
        success: false,
        error: "Invalid email format",
      });
    }

    if (!db) {
      console.error('❌ Firebase database not initialized');
      return res.status(500).json({
        success: false,
        error: "Firebase database not initialized",
      });
    }

    const receiverData = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    console.log(`💾 Attempting to save to Firebase: users/${userId}/receiver`);
    const receiverRef = db.ref(`users/${userId}/receiver`);
    const startTime = Date.now();
    
    try {
      // Use timeout wrapper for set operation
      await firebaseOperationWithTimeout(
        () => receiverRef.set(receiverData),
        `Firebase write for user ${userId}`,
        8000,
        0 // No retries for write operations
      );
      console.log(`✅ Receiver data saved successfully for user ${userId} (took ${Date.now() - startTime}ms):`, receiverData);
      
      // Verify the save by reading it back (with timeout)
      const snapshot = await firebaseOperationWithTimeout(
        () => receiverRef.once("value"),
        `Firebase read verification for user ${userId}`,
        8000,
        0
      );
      const savedData = snapshot.val();
      console.log(`✅ Verified saved data (took ${Date.now() - startTime}ms total):`, savedData);
      
      return res.json({
        success: true,
        data: savedData || receiverData,
        message: "Receiver data saved successfully",
      });
    } catch (firebaseError) {
      console.error(`❌ Firebase error saving receiver data (took ${Date.now() - startTime}ms):`, firebaseError);
      // Return a more user-friendly error instead of throwing
      return res.status(500).json({
        success: false,
        error: firebaseError.message.includes('timed out') 
          ? "Database connection timeout. Please try again later."
          : firebaseError.message || "Failed to save receiver data",
      });
    }
  } catch (error) {
    console.error("❌ Error saving receiver data:", error);
    console.error("Error stack:", error.stack);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Update receiver data
router.put("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, email } = req.body;

    if (!db) {
      return res.status(500).json({
        success: false,
        error: "Firebase database not initialized",
      });
    }

    const receiverRef = db.ref(`users/${userId}/receiver`);
    const snapshot = await receiverRef.once("value");
    const existingData = snapshot.val();

    if (!existingData) {
      return res.status(404).json({
        success: false,
        error: "Receiver data not found. Use POST to create.",
      });
    }

    const updateData = {
      ...existingData,
      updatedAt: new Date().toISOString(),
    };

    if (name) {
      updateData.name = name.trim();
    }

    if (email) {
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: "Invalid email format",
        });
      }
      updateData.email = email.trim().toLowerCase();
    }

    await receiverRef.update(updateData);

    return res.json({
      success: true,
      data: updateData,
      message: "Receiver data updated successfully",
    });
  } catch (error) {
    console.error("Error updating receiver data:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;

