// music-upload-firebase.js - API endpoint for uploading music files to Firebase Storage
const express = require("express");
const router = express.Router();
const multer = require("multer");
const { storage } = require("../configs/firebase");

// Configure multer to store files in memory (we'll upload to Firebase Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
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

    // Upload file to Firebase Storage
    const stream = fileRef.createWriteStream({
      metadata: {
        contentType: file.mimetype,
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
      return res.status(500).json({
        success: false,
        message: "Failed to upload file to Firebase Storage",
        error: error.message,
      });
    });

    // Handle successful upload
    stream.on("finish", async () => {
      try {
        // Make the file publicly accessible
        await fileRef.makePublic();

        // Get the public URL
        const publicUrl = `https://storage.googleapis.com/${storage.name}/${fileName}`;

        console.log(`✅ Music file uploaded to Firebase Storage: ${fileName} for user ${userId}`);
        console.log(`🔗 File URL: ${publicUrl}`);

        res.json({
          success: true,
          file: {
            filename: uniqueName,
            originalName: file.originalname,
            size: file.size,
            mimetype: file.mimetype,
            url: publicUrl,
            storagePath: fileName,
          },
          message: "Music file uploaded successfully to Firebase Storage",
        });
      } catch (error) {
        console.error("❌ Error making file public:", error);
        res.status(500).json({
          success: false,
          message: "File uploaded but failed to make it public",
          error: error.message,
        });
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

// GET /api/music-upload/:userId/:filename - Get uploaded music file info
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

module.exports = router;

