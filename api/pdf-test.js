// pdf-test.js - Test endpoint for PDF generation (for Postman testing)
const express = require("express");
const router = express.Router();

/**
 * POST /api/pdf-test/generate
 * Test endpoint for PDF generation
 * Body: {
 *   mainBody: "Letter content...",
 *   recipientName: "Faith",
 *   senderName: "Elgen",
 *   useTemplate: true/false
 * }
 */
router.post("/generate", async (req, res) => {
  try {
    const { mainBody, recipientName = "Faith", senderName = "Elgen", useTemplate = true } = req.body;

    if (!mainBody) {
      return res.status(400).json({
        success: false,
        message: "mainBody is required",
      });
    }

    // Note: This is a server-side test endpoint
    // In production, PDF generation happens on the client side
    // This endpoint is just for testing the logic
    
    res.status(200).json({
      success: true,
      message: "PDF test endpoint",
      data: {
        mainBody: mainBody.substring(0, 100) + "...",
        recipientName,
        senderName,
        useTemplate,
        note: "PDF generation happens on client-side. Use this to test parameters."
      }
    });
  } catch (error) {
    console.error("❌ Error in PDF test endpoint:", error);
    res.status(500).json({
      success: false,
      message: "Error testing PDF generation",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

module.exports = router;

