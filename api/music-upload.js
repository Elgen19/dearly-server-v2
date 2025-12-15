// music-upload.js - API endpoint for uploading music files to Firebase Storage
const express = require("express");
const router = express.Router();
const multer = require("multer");
const { storage } = require("../configs/firebase");

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
const multerStorage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// File filter - only allow audio files
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/ogg",
    "audio/aac",
    "audio/m4a",
    "audio/x-m4a",
  ];

  // Check mime type or file extension
  const isValidMime = allowedMimes.includes(file.mimetype);
  const isValidExt = /\.(mp3|wav|ogg|aac|m4a)$/i.test(file.originalname);

  if (isValidMime || isValidExt) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only audio files (mp3, wav, ogg, aac, m4a) are allowed."), false);
  }
};

// Configure multer with file filter
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// POST /api/music-upload/:userId - Upload a music file to Firebase Storage
router.post("/:userId", upload.single("music"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
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

    // Generate unique filename
    const timestamp = Date.now();
    const originalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    const uniqueName = `${userId}-${timestamp}-${originalName}`;
    const fileName = `music/${uniqueName}`;

    // Create a file reference in Firebase Storage
    const fileRef = storage.file(fileName);

    // Upload file to Firebase Storage with cache headers
    const stream = fileRef.createWriteStream({
      metadata: {
        contentType: file.mimetype,
        cacheControl: 'public, max-age=31536000', // Cache for 1 year (365 days * 24 hours * 60 minutes * 60 seconds)
        metadata: {
          originalName: file.originalname,
          uploadedBy: userId,
          uploadedAt: new Date().toISOString(),
        },
      },
      public: true, // Make file publicly accessible
    });

    // Handle upload errors
    stream.on("error", (error) => {
      console.error("❌ Error uploading to Firebase Storage:", error);
      console.error("❌ Error details:", {
        message: error.message,
        code: error.code,
        stack: error.stack,
      });
      
      // Don't send response if already sent
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: "Failed to upload file to Firebase Storage",
          error: error.message,
          code: error.code,
        });
      }
    });

    // Handle successful upload
    stream.on("finish", async () => {
      try {
        console.log(`✅ File upload stream finished for: ${fileName}`);
        
        // Make the file publicly accessible
        await fileRef.makePublic();
        console.log(`✅ File made public: ${fileName}`);

        // Get the public URL - use getSignedUrl for more reliable access
        const [publicUrl] = await fileRef.getSignedUrl({
          action: 'read',
          expires: '03-09-2491', // Far future date for permanent access
        });

        // Alternative: construct public URL directly
        const directUrl = `https://storage.googleapis.com/${storage.name}/${encodeURIComponent(fileName)}`;

        console.log(`✅ Music file uploaded to Firebase Storage: ${fileName} for user ${userId}`);
        console.log(`🔗 File URL: ${directUrl}`);

        // Check if response already sent
        if (res.headersSent) {
          console.warn("⚠️ Response already sent, skipping JSON response");
          return;
        }

        res.json({
          success: true,
          file: {
            filename: uniqueName,
            originalName: file.originalname,
            size: file.size,
            mimetype: file.mimetype,
            url: directUrl,
            signedUrl: publicUrl,
            storagePath: fileName,
          },
          message: "Music file uploaded successfully to Firebase Storage",
        });
      } catch (error) {
        console.error("❌ Error after upload stream finish:", error);
        console.error("❌ Error details:", {
          message: error.message,
          code: error.code,
          stack: error.stack,
        });
        
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: "File uploaded but failed to make it public or get URL",
            error: error.message,
            code: error.code,
          });
        }
      }
    });

    // Write file buffer to stream
    stream.end(file.buffer);
  } catch (error) {
    console.error("❌ Error uploading music file:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to upload music file",
      error: error.message,
    });
  }
});

// GET /api/music-upload/list/:userId - Get all music files uploaded by a user
router.get("/list/:userId", async (req, res) => {
  try {
    if (!storage) {
      return res.status(500).json({
        success: false,
        message: "Firebase Storage is not configured",
      });
    }

    const { userId } = req.params;

    // List all files in the music folder that start with the userId
    // Use retry logic for network errors
    const [files] = await retryOperation(async () => {
      return await storage.getFiles({
        prefix: `music/${userId}-`,
      });
    });

    if (!files || files.length === 0) {
      return res.json({
        success: true,
        files: [],
        message: "No music files found for this user",
      });
    }

    // Get metadata for each file and construct URLs
    // Wrap metadata retrieval in retry logic as well
    const musicFiles = await Promise.all(
      files.map(async (file) => {
        try {
          const [metadata] = await retryOperation(async () => {
            return await file.getMetadata();
          });
          
          const fileName = file.name.split('/').pop();
          const publicUrl = `https://storage.googleapis.com/${storage.name}/${file.name}`;
          
          // Extract original filename from metadata or filename
          const originalName = metadata.metadata?.originalName || 
                             fileName.replace(`${userId}-`, '').replace(/^\d+-/, '');

          return {
            id: `uploaded-${fileName}`,
            filename: fileName,
            originalName: originalName,
            size: parseInt(metadata.size || 0),
            mimetype: metadata.contentType,
            url: publicUrl,
            storagePath: file.name,
            uploadedAt: metadata.metadata?.uploadedAt || metadata.timeCreated,
          };
        } catch (error) {
          console.warn(`⚠️ Error getting metadata for file ${file.name}:`, error.message);
          // Return a basic file entry even if metadata fails
          const fileName = file.name.split('/').pop();
          const publicUrl = `https://storage.googleapis.com/${storage.name}/${file.name}`;
          return {
            id: `uploaded-${fileName}`,
            filename: fileName,
            originalName: fileName.replace(`${userId}-`, '').replace(/^\d+-/, ''),
            size: 0,
            mimetype: 'audio/mpeg',
            url: publicUrl,
            storagePath: file.name,
            uploadedAt: new Date().toISOString(),
          };
        }
      })
    );

    // Sort by upload date (newest first)
    musicFiles.sort((a, b) => {
      const dateA = new Date(a.uploadedAt || 0);
      const dateB = new Date(b.uploadedAt || 0);
      return dateB - dateA;
    });

    res.json({
      success: true,
      files: musicFiles,
      count: musicFiles.length,
    });
  } catch (error) {
    console.error("❌ Error getting user music files:", error);
    
    // Provide more specific error messages
    let errorMessage = "Failed to get user music files";
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      errorMessage = "Network connection issue. Please check your internet connection and try again.";
    } else if (error.code === 401 || error.code === 403) {
      errorMessage = "Authentication failed. Please check Firebase credentials.";
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: error.message,
      code: error.code,
    });
  }
});

// GET /api/music-upload/:userId/:filename - Get uploaded music file info from Firebase Storage
router.get("/:userId/:filename", async (req, res) => {
  try {
    if (!storage) {
      return res.status(500).json({
        success: false,
        message: "Firebase Storage is not configured",
      });
    }

    const { userId, filename } = req.params;
    const fileName = `music/${filename}`;
    const fileRef = storage.file(fileName);

    // Check if file exists
    const [exists] = await fileRef.exists();
    if (!exists) {
      return res.status(404).json({
        success: false,
        message: "File not found",
      });
    }

    // Get file metadata
    const [metadata] = await fileRef.getMetadata();
    const publicUrl = `https://storage.googleapis.com/${storage.name}/${fileName}`;

    res.json({
      success: true,
      file: {
        filename: filename,
        size: parseInt(metadata.size || 0),
        mimetype: metadata.contentType,
        url: publicUrl,
        uploadedAt: metadata.metadata?.uploadedAt || metadata.timeCreated,
      },
    });
  } catch (error) {
    console.error("❌ Error getting music file:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get music file info",
      error: error.message,
    });
  }
});

// DELETE /api/music-upload/:userId/:filename - Delete a music file from Firebase Storage
router.delete("/:userId/:filename", async (req, res) => {
  try {
    if (!storage) {
      return res.status(500).json({
        success: false,
        message: "Firebase Storage is not configured",
      });
    }

    const { userId, filename } = req.params;
    
    // Validate that the filename belongs to this user (security check)
    if (!filename.startsWith(`${userId}-`)) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own music files",
      });
    }

    const fileName = `music/${filename}`;
    const fileRef = storage.file(fileName);

    // Check if file exists
    const [exists] = await fileRef.exists();
    if (!exists) {
      return res.status(404).json({
        success: false,
        message: "File not found",
      });
    }

    // Delete the file
    await retryOperation(async () => {
      await fileRef.delete();
    });

    console.log(`✅ Music file deleted: ${fileName} for user ${userId}`);

    res.json({
      success: true,
      message: "Music file deleted successfully",
      filename: filename,
    });
  } catch (error) {
    console.error("❌ Error deleting music file:", error);
    
    let errorMessage = "Failed to delete music file";
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      errorMessage = "Network connection issue. Please check your internet connection and try again.";
    } else if (error.code === 404) {
      errorMessage = "File not found";
    } else if (error.code === 403) {
      errorMessage = "Permission denied. You can only delete your own files.";
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: error.message,
      code: error.code,
    });
  }
});

module.exports = router;
