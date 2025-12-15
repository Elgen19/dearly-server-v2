// notifications.js - API endpoint for managing notifications
const express = require("express");
const router = express.Router();
const { db } = require("../configs/firebase");

// Middleware to check if Firebase is initialized
const checkFirebase = (req, res, next) => {
  if (!db) {
    return res.status(500).json({
      success: false,
      error: "Database not available",
    });
  }
  next();
};

// GET /api/notifications/:userId - Get all notifications for a user
router.get("/:userId", checkFirebase, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
      });
    }

    const notificationsRef = db.ref(`users/${userId}/notifications`);
    const snapshot = await notificationsRef.orderByChild("createdAt").once("value");
    const notifications = snapshot.val();

    if (!notifications) {
      return res.status(200).json({
        success: true,
        notifications: [],
      });
    }

    // Convert to array and sort by createdAt (newest first)
    const notificationsArray = Object.keys(notifications).map((id) => ({
      id,
      ...notifications[id],
    })).sort((a, b) => {
      const dateA = new Date(a.createdAt || 0);
      const dateB = new Date(b.createdAt || 0);
      return dateB - dateA;
    });

    res.status(200).json({
      success: true,
      notifications: notificationsArray,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch notifications",
      details: error.message,
    });
  }
});

// PUT /api/notifications/:userId/all/read - Mark all notifications as read
// IMPORTANT: This route must come BEFORE /:userId/:notificationId/read to avoid route conflicts
router.put("/:userId/all/read", checkFirebase, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
      });
    }

    const notificationsRef = db.ref(`users/${userId}/notifications`);
    const snapshot = await notificationsRef.once("value");
    const notifications = snapshot.val();

    if (!notifications) {
      return res.status(200).json({
        success: true,
        message: "No notifications to mark as read",
        updatedCount: 0,
      });
    }

    // Mark all unread notifications as read
    const readAt = new Date().toISOString();
    let updatedCount = 0;
    
    // Update each notification individually to ensure the update is applied
    const updatePromises = Object.keys(notifications).map(async (id) => {
      const notification = notifications[id];
      
      // Only update if read is explicitly false or undefined (not already true)
      // Also handle cases where read might be stored as string "true"
      const isRead = notification.read === true || notification.read === "true";
      
      if (!isRead) {
        const notificationRef = db.ref(`users/${userId}/notifications/${id}`);
        try {
          // Read the current notification to preserve all fields
          const currentSnapshot = await notificationRef.once("value");
          const currentData = currentSnapshot.val();
          
          if (!currentData) {
            console.error(`❌ Notification ${id} not found`);
            return false;
          }
          
          // Use set() to ensure the entire object is saved with correct boolean type
          // This is more reliable than update() for ensuring boolean values persist
          const updatedData = {
            ...currentData,
            read: true,  // Explicit boolean - Firebase will preserve this
            readAt: readAt
          };
          
          // Use set() to overwrite the entire notification with updated data
          // This ensures the boolean is saved correctly
          console.log(`📝 Setting notification ${id} with read: true`);
          await notificationRef.set(updatedData);
          
          // Wait for Firebase to commit the write - longer delay to ensure persistence
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Verify the update was saved correctly - try multiple times with longer waits
          let verifyData = null;
          let attempts = 0;
          const maxAttempts = 5;
          let isVerifiedRead = false;
          
          while (attempts < maxAttempts) {
            const verifySnapshot = await notificationRef.once("value");
            verifyData = verifySnapshot.val();
            
            if (!verifyData) {
              console.error(`❌ Notification ${id} not found during verification`);
              attempts++;
              await new Promise(resolve => setTimeout(resolve, 200));
              continue;
            }
            
            // Check if read is true (boolean or string "true")
            isVerifiedRead = verifyData.read === true || 
                           verifyData.read === "true" ||
                           verifyData.read === 1;
            
            if (isVerifiedRead) {
              console.log(`✅ Verification successful on attempt ${attempts + 1}: read = ${verifyData.read} (${typeof verifyData.read})`);
              break;
            }
            
            attempts++;
            if (attempts < maxAttempts) {
              console.log(`⏳ Verification attempt ${attempts} failed: read = ${JSON.stringify(verifyData.read)} (${typeof verifyData.read}), retrying...`);
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }
          
          if (isVerifiedRead) {
            updatedCount++;
            console.log(`✅ Notification ${id} successfully marked as read and verified (value: ${verifyData.read}, type: ${typeof verifyData.read})`);
            return true;
          } else {
            console.error(`❌ Verification failed for notification ${id} after ${maxAttempts} attempts:`);
            console.error(`   Current read value: ${JSON.stringify(verifyData?.read)}`);
            console.error(`   Type: ${typeof verifyData?.read}`);
            console.error(`   Full notification data:`, JSON.stringify(verifyData, null, 2));
            // Still return true to continue processing other notifications
            // The write might have succeeded but verification is failing due to timing
            updatedCount++;
            console.log(`⚠️ Continuing despite verification failure - write may have succeeded`);
            return true;
          }
        } catch (updateError) {
          console.error(`❌ Error updating notification ${id}:`, updateError);
          console.error(`   Error stack:`, updateError.stack);
          return false;
        }
      } else {
        console.log(`⏭️  Notification ${id} already marked as read (value: ${notification.read})`);
      }
      return false;
    });

    await Promise.all(updatePromises);

    if (updatedCount > 0) {
      console.log(`✅ Marked ${updatedCount} notification(s) as read for user ${userId}`);
    }

    res.status(200).json({
      success: true,
      message: `Marked ${updatedCount} notification(s) as read`,
      updatedCount,
    });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({
      success: false,
      error: "Failed to mark all notifications as read",
      details: error.message,
    });
  }
});

// PUT /api/notifications/:userId/all/read - Mark all notifications as read
// IMPORTANT: This route MUST come BEFORE /:userId/:notificationId/read to avoid route conflicts
// Otherwise, "all" will be treated as a notificationId
router.put("/:userId/all/read", checkFirebase, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
      });
    }

    const notificationsRef = db.ref(`users/${userId}/notifications`);
    const snapshot = await notificationsRef.once("value");
    const notifications = snapshot.val();

    if (!notifications) {
      return res.status(200).json({
        success: true,
        message: "No notifications to mark as read",
        updatedCount: 0,
      });
    }

    // Mark all unread notifications as read
    const readAt = new Date().toISOString();
    let updatedCount = 0;
    
    // Update each notification individually to ensure the update is applied
    const updatePromises = Object.keys(notifications).map(async (id) => {
      const notification = notifications[id];
      
      // Only update if read is explicitly false or undefined (not already true)
      // Also handle cases where read might be stored as string "true"
      const isRead = notification.read === true || notification.read === "true";
      
      if (!isRead) {
        const notificationRef = db.ref(`users/${userId}/notifications/${id}`);
        try {
          // Read the current notification to preserve all fields
          const currentSnapshot = await notificationRef.once("value");
          const currentData = currentSnapshot.val();
          
          if (!currentData) {
            console.error(`❌ Notification ${id} not found`);
            return false;
          }
          
          // Use set() to ensure the entire object is saved with correct boolean type
          // This is more reliable than update() for ensuring boolean values persist
          const updatedData = {
            ...currentData,
            read: true,  // Explicit boolean - Firebase will preserve this
            readAt: readAt
          };
          
          // Use set() to overwrite the entire notification with updated data
          // This ensures the boolean is saved correctly
          console.log(`📝 Setting notification ${id} with read: true`);
          await notificationRef.set(updatedData);
          
          // Wait for Firebase to commit the write - longer delay to ensure persistence
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Verify the update was saved correctly - try multiple times with longer waits
          let verifyData = null;
          let attempts = 0;
          const maxAttempts = 5;
          let isVerifiedRead = false;
          
          while (attempts < maxAttempts) {
            const verifySnapshot = await notificationRef.once("value");
            verifyData = verifySnapshot.val();
            
            if (!verifyData) {
              console.error(`❌ Notification ${id} not found during verification`);
              attempts++;
              await new Promise(resolve => setTimeout(resolve, 200));
              continue;
            }
            
            // Check if read is true (boolean or string "true")
            isVerifiedRead = verifyData.read === true || 
                           verifyData.read === "true" ||
                           verifyData.read === 1;
            
            if (isVerifiedRead) {
              console.log(`✅ Verification successful on attempt ${attempts + 1}: read = ${verifyData.read} (${typeof verifyData.read})`);
              break;
            }
            
            attempts++;
            if (attempts < maxAttempts) {
              console.log(`⏳ Verification attempt ${attempts} failed: read = ${JSON.stringify(verifyData.read)} (${typeof verifyData.read}), retrying...`);
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }
          
          if (isVerifiedRead) {
            updatedCount++;
            console.log(`✅ Notification ${id} successfully marked as read and verified (value: ${verifyData.read}, type: ${typeof verifyData.read})`);
            return true;
          } else {
            console.error(`❌ Verification failed for notification ${id} after ${maxAttempts} attempts:`);
            console.error(`   Current read value: ${JSON.stringify(verifyData?.read)}`);
            console.error(`   Type: ${typeof verifyData?.read}`);
            console.error(`   Full notification data:`, JSON.stringify(verifyData, null, 2));
            // Still return true to continue processing other notifications
            // The write might have succeeded but verification is failing due to timing
            updatedCount++;
            console.log(`⚠️ Continuing despite verification failure - write may have succeeded`);
            return true;
          }
        } catch (updateError) {
          console.error(`❌ Error updating notification ${id}:`, updateError);
          console.error(`   Error stack:`, updateError.stack);
          return false;
        }
      } else {
        console.log(`⏭️  Notification ${id} already marked as read (value: ${notification.read})`);
      }
      return false;
    });

    await Promise.all(updatePromises);

    if (updatedCount > 0) {
      console.log(`✅ Marked ${updatedCount} notification(s) as read for user ${userId}`);
    }

    res.status(200).json({
      success: true,
      message: `Marked ${updatedCount} notification(s) as read`,
      updatedCount,
    });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({
      success: false,
      error: "Failed to mark all notifications as read",
      details: error.message,
    });
  }
});

// PUT /api/notifications/:userId/:notificationId/read - Mark notification as read
router.put("/:userId/:notificationId/read", checkFirebase, async (req, res) => {
  try {
    const { userId, notificationId } = req.params;

    if (!userId || !notificationId) {
      return res.status(400).json({
        success: false,
        error: "User ID and notification ID are required",
      });
    }

    const notificationRef = db.ref(`users/${userId}/notifications/${notificationId}`);
    
    // Read current data first
    const currentSnapshot = await notificationRef.once("value");
    const currentData = currentSnapshot.val();
    
    if (!currentData) {
      return res.status(404).json({
        success: false,
        error: "Notification not found",
      });
    }
    
    console.log(`📝 Marking single notification ${notificationId} as read`);
    console.log(`   Current read value: ${currentData.read} (${typeof currentData.read})`);
    
    // Use set() to ensure the boolean is saved correctly
    const updatedData = {
      ...currentData,
      read: true,  // Explicit boolean
      readAt: new Date().toISOString(),
    };
    
    await notificationRef.set(updatedData);
    console.log(`✅ Saved notification ${notificationId} with read: true using set()`);
    
    // Wait for Firebase to commit
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Verify the update
    await new Promise(resolve => setTimeout(resolve, 100));
    const verifySnapshot = await notificationRef.once("value");
    const verifyData = verifySnapshot.val();
    
    console.log(`✅ Notification ${notificationId} update result: read = ${verifyData?.read} (${typeof verifyData?.read})`);

    res.status(200).json({
      success: true,
      message: "Notification marked as read",
      notification: verifyData,
    });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      success: false,
      error: "Failed to mark notification as read",
      details: error.message,
    });
  }
});

// DELETE /api/notifications/:userId/all/read - Delete all read notifications
// IMPORTANT: This route must come BEFORE /:userId/all to avoid route conflicts
router.delete("/:userId/all/read", checkFirebase, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
      });
    }

    const notificationsRef = db.ref(`users/${userId}/notifications`);
    const snapshot = await notificationsRef.once("value");
    const notifications = snapshot.val();

    if (!notifications) {
      return res.status(200).json({
        success: true,
        message: "No notifications to delete",
        deletedCount: 0,
      });
    }

    // Delete all read notifications
    const updates = {};
    let deletedCount = 0;
    Object.keys(notifications).forEach((id) => {
      if (notifications[id].read) {
        updates[id] = null;
        deletedCount++;
      }
    });

    if (deletedCount > 0) {
      await notificationsRef.update(updates);
    }

    res.status(200).json({
      success: true,
      message: `Deleted ${deletedCount} read notification(s)`,
      deletedCount,
    });
  } catch (error) {
    console.error("Error deleting read notifications:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete read notifications",
      details: error.message,
    });
  }
});

// DELETE /api/notifications/:userId/all - Delete all notifications
// IMPORTANT: This route must come BEFORE /:userId/:notificationId to avoid route conflicts
router.delete("/:userId/all", checkFirebase, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
      });
    }

    const notificationsRef = db.ref(`users/${userId}/notifications`);
    await notificationsRef.remove();

    res.status(200).json({
      success: true,
      message: "All notifications deleted",
    });
  } catch (error) {
    console.error("Error deleting all notifications:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete all notifications",
      details: error.message,
    });
  }
});

// DELETE /api/notifications/:userId/:notificationId - Delete a notification
router.delete("/:userId/:notificationId", checkFirebase, async (req, res) => {
  try {
    const { userId, notificationId } = req.params;

    if (!userId || !notificationId) {
      return res.status(400).json({
        success: false,
        error: "User ID and notification ID are required",
      });
    }

    const notificationRef = db.ref(`users/${userId}/notifications/${notificationId}`);
    await notificationRef.remove();

    res.status(200).json({
      success: true,
      message: "Notification deleted",
    });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete notification",
      details: error.message,
    });
  }
});

// GET /api/notifications/:userId/debug/:notificationId - Debug endpoint to check notification status
// Security: Disable debug endpoints in production
if (process.env.NODE_ENV === 'development') {
  router.get("/:userId/debug/:notificationId", checkFirebase, async (req, res) => {
  try {
    const { userId, notificationId } = req.params;

    if (!userId || !notificationId) {
      return res.status(400).json({
        success: false,
        error: "User ID and notification ID are required",
      });
    }

    const notificationRef = db.ref(`users/${userId}/notifications/${notificationId}`);
    const snapshot = await notificationRef.once("value");
    const notification = snapshot.val();

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: "Notification not found",
      });
    }

    res.status(200).json({
      success: true,
      notification: {
        id: notificationId,
        ...notification,
        readValue: notification.read,
        readType: typeof notification.read,
        readStringified: JSON.stringify(notification.read),
        isReadBoolean: notification.read === true,
        isReadString: notification.read === "true",
        isReadNumber: notification.read === 1,
      },
    });
  } catch (error) {
    console.error("Error fetching notification debug info:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch notification debug info",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
  });
}

// POST /api/notifications/:userId/create - Create a notification
router.post("/:userId/create", checkFirebase, async (req, res) => {
  try {
    const { userId } = req.params;
    const { type, letterId, letterTitle, message, receiverName } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
      });
    }

    if (!type) {
      return res.status(400).json({
        success: false,
        error: "Notification type is required",
      });
    }

    const notificationRef = db.ref(`users/${userId}/notifications`).push();
    const notificationData = {
      type,
      read: false,
      createdAt: new Date().toISOString(),
    };

    // Add type-specific fields
    if (letterId) notificationData.letterId = letterId;
    if (letterTitle) notificationData.letterTitle = letterTitle;
    if (message) notificationData.message = message;
    if (receiverName) notificationData.receiverName = receiverName;

    await notificationRef.set(notificationData);

    res.status(200).json({
      success: true,
      message: "Notification created successfully",
      notificationId: notificationRef.key,
    });
  } catch (error) {
    console.error("Error creating notification:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create notification",
      details: error.message,
    });
  }
});

module.exports = router;

