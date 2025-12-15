// audio-proxy.js - Proxy endpoint to serve audio files from Firebase Storage with CORS headers
const express = require("express");
const router = express.Router();
const { storage } = require("../configs/firebase");

// Handle all requests to this router (catch-all middleware)
router.use(async (req, res, next) => {
  try {
    // Extract file path from the request
    // Since router is mounted at /api/audio-proxy, req.path gives us the path after mount point
    // Remove leading slash
    let filePath = (req.path || '').replace(/^\//, '');
    
    // Also handle originalUrl as fallback
    if (!filePath && req.originalUrl) {
      const match = req.originalUrl.match(/\/api\/audio-proxy\/(.+)$/);
      if (match && match[1]) {
        filePath = match[1];
      }
    }
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: "File path is required",
      });
    }
    
    // Decode the file path in case it was URL encoded
    try {
      filePath = decodeURIComponent(filePath);
    } catch (e) {
      // If decode fails, use original path
      console.warn('⚠️ Failed to decode file path, using original:', filePath);
    }

    if (!storage) {
      console.error("❌ Firebase Storage is not initialized.");
      return res.status(500).json({
        success: false,
        message: "Firebase Storage is not configured.",
      });
    }

    // Create a reference to the file in Firebase Storage
    const fileRef = storage.file(filePath);

    // Check if file exists
    const [exists] = await fileRef.exists();
    if (!exists) {
      return res.status(404).json({
        success: false,
        message: "Audio file not found",
      });
    }

    // Get file metadata
    const [metadata] = await fileRef.getMetadata();
    
    // Set CORS headers
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': metadata.contentType || 'audio/mpeg',
      'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
    });

    // Stream the file
    const stream = fileRef.createReadStream();
    
    stream.on('error', (error) => {
      console.error('❌ Error streaming audio file:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error streaming audio file',
        });
      }
    });

    stream.pipe(res);
    
    // Don't call next() - we've handled the request

  } catch (error) {
    console.error("❌ Error proxying audio file:", error);
    
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to proxy audio file",
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
});

module.exports = router;
