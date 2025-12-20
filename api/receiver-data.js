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
  try {
    const { userId } = req.params;

    if (!db) {
      if (process.env.NODE_ENV === 'development') {
        console.error('❌ Firebase database is not initialized');
      }
      return res.status(500).json({
        success: false,
        error: "Firebase database not initialized",
      });
    }

    const receiverRef = db.ref(`users/${userId}/receiver`);
    
    let snapshot;
    try {
      snapshot = await firebaseOperationWithTimeout(
        () => receiverRef.once("value"),
        `Firebase read for user ${userId}`,
        8000,
        0
      );
    } catch (operationError) {
      const errorMessage = operationError.message || 'Unknown error';
      if (process.env.NODE_ENV === 'development') {
        console.warn(`⚠️ Firebase operation failed:`, errorMessage);
        if (errorMessage.includes('timed out')) {
          console.warn(`⚠️ CONNECTIVITY ISSUE: Firebase operations timing out`);
        }
      }
      
      return res.json({
        success: true,
        data: null,
        message: "No receiver data found (database connection issue)",
      });
    }
    
    const receiverData = snapshot.val();

    if (!receiverData) {
      return res.json({
        success: true,
        data: null,
        message: "No receiver data found",
      });
    }

    return res.json({
      success: true,
      data: receiverData,
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error(`❌ Error fetching receiver data:`, error);
      console.error("Error stack:", error.stack);
    }
    
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

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        error: "Name and email are required",
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Invalid email format",
      });
    }

    if (!db) {
      if (process.env.NODE_ENV === 'development') {
        console.error('❌ Firebase database not initialized');
      }
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

    const receiverRef = db.ref(`users/${userId}/receiver`);
    
    try {
      await firebaseOperationWithTimeout(
        () => receiverRef.set(receiverData),
        `Firebase write for user ${userId}`,
        8000,
        0
      );
      
      // Verify the save by reading it back
      const snapshot = await firebaseOperationWithTimeout(
        () => receiverRef.once("value"),
        `Firebase read verification for user ${userId}`,
        8000,
        0
      );
      const savedData = snapshot.val();
      
      return res.json({
        success: true,
        data: savedData || receiverData,
        message: "Receiver data saved successfully",
      });
    } catch (firebaseError) {
      if (process.env.NODE_ENV === 'development') {
        console.error(`❌ Firebase error saving receiver data:`, firebaseError);
      }
      return res.status(500).json({
        success: false,
        error: firebaseError.message.includes('timed out') 
          ? "Database connection timeout. Please try again later."
          : firebaseError.message || "Failed to save receiver data",
      });
    }
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error("❌ Error saving receiver data:", error);
      console.error("Error stack:", error.stack);
    }
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

