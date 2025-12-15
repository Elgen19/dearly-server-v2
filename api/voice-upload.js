// voice-upload.js - API endpoint for uploading voice messages to Firebase Storage
const express = require("express");
const router = express.Router();
const multer = require("multer");
const { storage, db } = require("../configs/firebase");

// Helper function to retry operations with exponential backoff for network errors
const retryOperation = async (operation, maxRetries = 3, delay = 1000) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      // Check if it's a network error that should be retried
      const isNetworkError = error.code === 'ECONNRESET' || 
                            error.code === 'ETIMEDOUT' || 
                            error.code === 'ENOTFOUND' ||
                            error.code === 'ECONNREFUSED' ||
                            (error.message && error.message.includes('ECONNRESET'));
      
      const isRetryable = error.code === 429 || // Rate limit
                         error.code === 503 || // Service unavailable
                         error.code === 500 || // Internal server error
                         isNetworkError;
      
      if (isRetryable && attempt < maxRetries - 1) {
        const waitTime = delay * Math.pow(2, attempt); // Exponential backoff
        console.warn(`⚠️ Retry attempt ${attempt + 1}/${maxRetries} after ${waitTime}ms for error: ${error.code || error.message}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
};

// Configure multer to store files in memory (we'll upload to Firebase Storage)
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    "audio/webm",
    "audio/webm;codecs=opus",
    "audio/ogg",
    "audio/wav",
    "audio/mp3",
    "audio/mpeg",
    "audio/aac",
    "audio/m4a",
    "audio/x-m4a",
  ];

  // Check mime type or file extension
  const isValidMime = allowedMimes.includes(file.mimetype);
  const isValidExt = /\.(webm|ogg|wav|mp3|aac|m4a)$/i.test(file.originalname);

  if (isValidMime || isValidExt) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only audio files (webm, ogg, wav, mp3, aac, m4a) are allowed."), false);
  }
};

// Configure multer with file filter
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit for voice messages
  },
});

// POST /api/voice-upload/:userId - Upload a voice message to Firebase Storage
router.post("/:userId", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No audio file uploaded",
      });
    }

    if (!storage) {
      console.error("❌ Firebase Storage is not initialized. Check FIREBASE_STORAGE_BUCKET in .env file.");
      return res.status(500).json({
        success: false,
        message: "Firebase Storage is not configured. Please set FIREBASE_STORAGE_BUCKET in your .env file.",
      });
    }

    const userId = req.params.userId || "anonymous";
    const file = req.file;
    const { letterId, receiverName } = req.body;

    // Generate unique filename
    const timestamp = Date.now();
    const originalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    const uniqueName = `voice-messages/${userId}-${timestamp}-${originalName}`;

    console.log(`📤 Uploading voice message: ${uniqueName} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

    // Create a file reference in Firebase Storage
    const fileRef = storage.file(uniqueName);

    // Get the public URL (we'll construct it after upload)
    const publicUrl = `https://storage.googleapis.com/${storage.name}/${uniqueName}`;

    // Upload file to Firebase Storage with retry logic
    await retryOperation(async () => {
      const stream = fileRef.createWriteStream({
        metadata: {
          contentType: file.mimetype,
          metadata: {
            uploadedBy: userId,
            letterId: letterId || null,
            receiverName: receiverName || null,
            uploadedAt: new Date().toISOString(),
          },
          cacheControl: 'public, max-age=31536000', // Cache for 1 year
        },
        public: true, // Make file publicly accessible (no need for separate makePublic call)
      });

      return new Promise((resolve, reject) => {
        // Set timeout for upload (30 seconds)
        const timeout = setTimeout(() => {
          stream.destroy();
          reject(new Error('Upload timeout after 30 seconds'));
        }, 30000);

        stream.on('error', (error) => {
          clearTimeout(timeout);
          console.error('❌ Error uploading voice message to Firebase Storage:', error);
          reject(error);
        });

        stream.on('finish', () => {
          clearTimeout(timeout);
          // File is already public when public: true is set, no need for makePublic()
          resolve();
        });

        stream.end(file.buffer);
      });
    });

    console.log(`✅ Voice message uploaded successfully: ${publicUrl}`);

    // Create notification for sender when receiver sends voice message
    if (db) {
      try {
        // Get letter info if letterId is provided
        let letterTitle = 'Your Letter';
        let receiverNameToUse = receiverName || 'Your loved one';
        
        if (letterId) {
          try {
            // Try to find the letter to get its title
            // We need to search all users' letters to find the one with this letterId
            // For now, we'll use a simpler approach - just use receiverName
            // (A more robust solution would cache letterId -> userId mapping)
          } catch (letterError) {
            console.log("Could not fetch letter details for notification");
          }
        }

        const notificationsRef = db.ref(`users/${userId}/notifications`);
        const notificationRef = notificationsRef.push();
        await notificationRef.set({
          type: "voice_message",
          letterId: letterId || null,
          letterTitle: letterTitle,
          receiverName: receiverNameToUse,
          message: `${receiverNameToUse} sent you a voice message! 🎤`,
          read: false,
          createdAt: new Date().toISOString(),
        });
        console.log(`✅ Notification created for voice message from ${receiverNameToUse}`);
      } catch (notificationError) {
        console.error("❌ Error creating voice message notification:", notificationError);
        // Don't fail the request if notification creation fails
      }
    }

    // Return success response immediately (don't wait for database save)
    res.status(200).json({
      success: true,
      message: "Voice message uploaded successfully",
      url: publicUrl,
      fileName: uniqueName,
      size: file.size,
      mimeType: file.mimetype,
    });

    // Save voice message metadata to Firebase Realtime Database asynchronously (fire and forget)
    // This doesn't block the response
    if (db && letterId) {
      // Use setImmediate to run this after the response is sent
      setImmediate(async () => {
        try {
          const voiceMessageRef = db.ref(`users/${userId}/letters/${letterId}/voiceMessages`).push();
          await voiceMessageRef.set({
            url: publicUrl,
            fileName: uniqueName,
            receiverName: receiverName || null,
            uploadedAt: new Date().toISOString(),
            size: file.size,
            mimeType: file.mimetype,
          });
          console.log(`✅ Voice message metadata saved to database`);
        } catch (dbError) {
          console.error('⚠️ Warning: Failed to save voice message metadata to database:', dbError);
          // Database save failure doesn't affect the upload success
        }
      });
    }
  } catch (error) {
    console.error("❌ Error uploading voice message:", error);

    // Provide more specific error messages
    let errorMessage = "Failed to upload voice message to Firebase Storage";
    if (error.message.includes("Invalid file type")) {
      errorMessage = error.message;
    } else if (error.message.includes("File too large") || error.code === "LIMIT_FILE_SIZE") {
      errorMessage = "File size exceeds the maximum limit of 20MB";
    } else if (error.code === "ECONNRESET" || error.code === "ETIMEDOUT") {
      errorMessage = "Network error. Please check your connection and try again.";
    } else if (error.code === 401 || error.code === 403) {
      errorMessage = "Firebase Storage authentication failed. Please check your Firebase credentials.";
    }

    res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

module.exports = router;

