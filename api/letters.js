// API endpoint for managing letters
const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { db, storage } = require("../configs/firebase");
const { verifyAuth, verifyOwnership } = require("../middleware/auth");

// Security: Only log requests in development mode
if (process.env.NODE_ENV === 'development') {
  router.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'POST') {
      console.log(`📥 ${req.method} request received:`, {
        path: req.path,
        originalUrl: req.originalUrl,
        baseUrl: req.baseUrl,
        url: req.url,
        params: req.params
      });
    }
    next();
  });
}

// Helper function to generate secure token
const generateToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Helper function to hash security answers
const hashAnswer = (answer) => {
  if (!answer) return null;
  // Normalize the answer: trim, lowercase, remove extra spaces
  const normalized = String(answer).trim().toLowerCase().replace(/\s+/g, ' ');
  // Create SHA-256 hash
  return crypto.createHash('sha256').update(normalized).digest('hex');
};

// Rate limiting for token access (prevent abuse)
const tokenAccessLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per 15 minutes per IP
  message: 'Too many requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for token regeneration (stricter)
const tokenRegenerationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 regenerations per hour per IP
  message: 'Too many token regenerations. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware to check if Firebase is initialized
const checkFirebase = (req, res, next) => {
  if (!db) {
    return res.status(503).json({ 
      message: "Firebase is not configured. Please set up Firebase credentials." 
    });
  }
  next();
};

// GET /api/letters/responses/all/:userId - Get all responses across all letters for a user
// Using a more specific path to avoid any route conflicts
router.get("/responses/all/:userId", checkFirebase, async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`✅ Route /responses/all/:userId matched for userId: ${userId}`);
    console.log(`🔍 GET /api/letters/responses/all/${userId} - Fetching all responses`);

    // Fetch all letters for the user
    const lettersRef = db.ref(`users/${userId}/letters`);
    console.log(`📂 Checking path: users/${userId}/letters`);
    const lettersSnapshot = await lettersRef.once("value");
    const letters = lettersSnapshot.val();

    if (!letters) {
      console.log(`ℹ️ No letters found for userId: ${userId}`);
      return res.status(200).json([]);
    }

    console.log(`✅ Found ${Object.keys(letters).length} letters for userId: ${userId}`);

    // Fetch all responses from all letters
    const allResponses = [];
    const letterIds = Object.keys(letters);

    for (const letterId of letterIds) {
      const responsesPath = `users/${userId}/letters/${letterId}/responses`;
      console.log(`📂 Checking responses at: ${responsesPath}`);
      const responsesRef = db.ref(responsesPath);
      const responsesSnapshot = await responsesRef.once("value");
      const responses = responsesSnapshot.val();

      if (responses) {
        console.log(`✅ Found ${Object.keys(responses).length} responses for letter ${letterId}`);
        // Convert responses object to array and add letter info
        const responsesArray = Object.keys(responses).map(key => ({
          id: key,
          responseId: key,
          letterId: letterId,
          letterTitle: letters[letterId].introductory || letters[letterId].title || 'Untitled Letter',
          letterCreatedAt: letters[letterId].createdAt,
          ...responses[key]
        }));
        allResponses.push(...responsesArray);
      } else {
        console.log(`ℹ️ No responses found for letter ${letterId}`);
      }
    }

    console.log(`✅ Total responses found: ${allResponses.length}`);

    // Sort by creation date (newest first)
    allResponses.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0);
      const dateB = new Date(b.createdAt || 0);
      return dateB - dateA;
    });

    console.log(`📤 Returning ${allResponses.length} responses`);
    res.status(200).json(allResponses);
  } catch (error) {
    console.error("❌ Error fetching all responses:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Error fetching all responses",
      error: error.message
    });
  }
});

// GET /api/letters/:userId - Fetch all letters for a specific user
router.get("/:userId", checkFirebase, async (req, res, next) => {
  // Skip if this is actually the all-responses route
  if (req.params.userId === 'all-responses') {
    console.log('⚠️ Route /:userId matched "all-responses", passing to next handler');
    return next(); // Let the /all-responses/:userId route handle it
  }
  
  try {
    const { userId } = req.params;

    const lettersRef = db.ref(`users/${userId}/letters`);
    const snapshot = await lettersRef.once("value");
    const letters = snapshot.val();

    if (!letters) {
      return res.status(200).json([]);
    }

    // Convert Firebase object to array and sort by createdAt (newest first)
    const lettersArray = Object.keys(letters).map((key) => ({
      id: key,
      ...letters[key],
    })).sort((a, b) => {
      const dateA = new Date(a.createdAt || 0);
      const dateB = new Date(b.createdAt || 0);
      return dateB - dateA;
    });

    // Debug logging - check security fields in all letters
    console.log('🔍 All letters for user:', userId, '- Total:', lettersArray.length);
    lettersArray.forEach((letter, index) => {
      console.log(`🔍 Letter ${index + 1} (${letter.id}):`, {
        hasSecurityType: 'securityType' in letter,
        securityType: letter.securityType,
        hasSecurityConfig: 'securityConfig' in letter,
        securityConfig: letter.securityConfig ? Object.keys(letter.securityConfig) : null,
        hasIntroductoryStyle: 'introductoryStyle' in letter,
        introductoryStyle: letter.introductoryStyle,
        hasMainBodyStyle: 'mainBodyStyle' in letter,
        mainBodyStyle: letter.mainBodyStyle,
        hasClosingStyle: 'closingStyle' in letter,
        closingStyle: letter.closingStyle
      });
    });

    res.status(200).json(lettersArray);
  } catch (error) {
    console.error("Error fetching letters:", error);
    res.status(500).json({ 
      message: "Error fetching letters", 
      error: error.message 
    });
  }
});

// GET /api/letters/token/:token - Fetch a letter by secure token (RECOMMENDED)
router.get("/token/:token", tokenAccessLimiter, checkFirebase, async (req, res) => {
  try {
    const { token } = req.params;
    
    // Fetch token data
    const tokenRef = db.ref(`letterTokens/${token}`);
    const tokenSnapshot = await tokenRef.once("value");
    const tokenData = tokenSnapshot.val();
    
    if (!tokenData) {
      console.log('❌ Token not found in database:', token.substring(0, 8) + '...');
      return res.status(404).json({ message: "Invalid or expired link" });
    }
    
    // Check if token is active
    if (tokenData.isActive === false) {
      console.log('❌ Token is inactive (revoked):', token.substring(0, 8) + '...');
      return res.status(410).json({ message: "Link has been revoked. The letter owner may have regenerated the link." });
    }
    
    // Check expiration
    if (tokenData.expiresAt && new Date(tokenData.expiresAt) < new Date()) {
      return res.status(410).json({ message: "Link has expired" });
    }
    
    // Auto-renewal: If token expires within 30 days, extend it by 1 year
    // Limit: Maximum 10 renewals to prevent indefinite extension
    const expiresAt = new Date(tokenData.expiresAt);
    const now = new Date();
    const daysUntilExpiration = (expiresAt - now) / (1000 * 60 * 60 * 24);
    const renewalCount = tokenData.renewalCount || 0;
    const maxRenewals = 10; // Maximum 10 renewals = 10 years total lifetime
    
    if (daysUntilExpiration <= 30 && daysUntilExpiration > 0 && renewalCount < maxRenewals) {
      // Token is close to expiration and hasn't exceeded max renewals, extend it
      const newExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year from now
      await tokenRef.update({ 
        expiresAt: newExpiresAt,
        renewalCount: renewalCount + 1,
        lastRenewedAt: new Date().toISOString()
      });
      console.log(`🔄 Token auto-renewed: ${token.substring(0, 8)}... (expires in ${daysUntilExpiration.toFixed(1)} days, extended to ${newExpiresAt}, renewal ${renewalCount + 1}/${maxRenewals})`);
    } else if (renewalCount >= maxRenewals) {
      console.log(`⚠️ Token ${token.substring(0, 8)}... has reached max renewals (${maxRenewals}), will not auto-renew`);
    }
    
    // Fetch letter using token data
    const { userId, letterId } = tokenData;
    console.log('🔍 Token lookup successful:', { 
      token: token.substring(0, 8) + '...', 
      userId, 
      letterId 
    });
    
    const letterRef = db.ref(`users/${userId}/letters/${letterId}`);
    const letterSnapshot = await letterRef.once("value");
    const letter = letterSnapshot.val();

    if (!letter) {
      console.log('❌ Letter not found in database:', { userId, letterId });
      return res.status(404).json({ 
        message: "Letter not found",
        hint: "The letter may have been deleted or the token may be invalid"
      });
    }
    
    console.log('✅ Letter found:', { userId, letterId, hasSecurity: !!letter.securityType });
    
    // Log access (optional - for analytics)
    const accessLogRef = db.ref(`letterTokens/${token}/accessLog`).push();
    await accessLogRef.set({
      accessedAt: new Date().toISOString(),
      ip: req.ip || req.connection.remoteAddress
    });
    
    // Return letter data (without sensitive token info)
    // IMPORTANT: userId must come AFTER spreading letter to ensure it's not overwritten
    // The userId from the token is the correct sender's userId, not any userId that might be in letter data
    res.status(200).json({ 
      id: letterId,
      ...letter,
      userId: userId, // Include userId AFTER spreading letter to ensure it's the correct sender's userId
      // Include token in response for frontend to use in URL
      token: token
    });
  } catch (error) {
    console.error("Error fetching letter by token:", error);
    res.status(500).json({ 
      message: "Error fetching letter", 
      error: error.message 
    });
  }
});

// GET /api/letters/:userId/:letterId - DEPRECATED - Legacy endpoint removed for security
// All letter access must now use token-based URLs: /api/letters/token/:token
router.get("/:userId/:letterId", checkFirebase, async (req, res, next) => {
  // Skip if this is actually the all-responses route (shouldn't happen, but safety check)
  if (req.params.letterId === 'all-responses') {
    console.log('⚠️ Route /:userId/:letterId matched all-responses, passing to next handler');
    console.log('⚠️ This should not happen - /:userId/all-responses should match first');
    return next(); // Let the all-responses route handle it (though it should have matched first)
  }
  
  console.log(`❌ Deprecated route matched: /:userId/:letterId with userId=${req.params.userId}, letterId=${req.params.letterId}`);
  return res.status(410).json({ 
    message: "Legacy URL format is no longer supported. Please use token-based URLs for security.",
    error: "DEPRECATED_ENDPOINT",
    info: "All letters must be accessed via /api/letters/token/:token endpoint"
  });
});

// IMPORTANT: Specific routes with more path segments must come BEFORE general routes
// to prevent route matching conflicts. Express matches routes in order.

// POST /api/letters/:userId/:letterId/validate-security - Validate security answer
// Moved here before POST /:userId to prevent route conflicts
router.post("/:userId/:letterId/validate-security", checkFirebase, async (req, res) => {
  console.log('🔐 validate-security endpoint hit:', { userId: req.params.userId, letterId: req.params.letterId });
  console.log('🔐 Request body:', req.body);
  try {
    const { userId, letterId } = req.params;
    const { answer } = req.body; // User's submitted answer

    console.log('🔐 Processing validation:', { userId, letterId, hasAnswer: !!answer, answer });

    if (!answer) {
      console.log('❌ No answer provided');
      return res.status(400).json({ 
        success: false,
        message: "Answer is required" 
      });
    }

    // Fetch the letter
    console.log('🔐 Fetching letter from Firebase...');
    const letterRef = db.ref(`users/${userId}/letters/${letterId}`);
    const snapshot = await letterRef.once("value");
    const letter = snapshot.val();

    console.log('🔐 Letter fetched:', { found: !!letter, hasSecurityType: !!letter?.securityType, hasSecurityConfig: !!letter?.securityConfig });

    if (!letter) {
      console.log('❌ Letter not found in database');
      return res.status(404).json({ 
        success: false,
        message: "Letter not found" 
      });
    }

    // Check if letter has security
    if (!letter.securityType || !letter.securityConfig) {
      return res.status(400).json({ 
        success: false,
        message: "Letter does not have security configured" 
      });
    }

    const { securityType, securityConfig } = letter;
    let isCorrect = false;

    // Validate based on security type
    if (securityType === 'quiz') {
      // Hash the user's answer and compare with stored hash
      const userAnswerHash = hashAnswer(answer);
      const storedHash = securityConfig.correctAnswerHash;
      
      if (!storedHash) {
        return res.status(500).json({ 
          success: false,
          message: "Security configuration error: hash not found" 
        });
      }

      isCorrect = userAnswerHash === storedHash;
    } else if (securityType === 'date') {
      // For dates, normalize the date string first
      const dateStr = String(answer).trim();
      const userDateHash = hashAnswer(dateStr);
      const storedHash = securityConfig.correctDateHash;
      
      if (!storedHash) {
        return res.status(500).json({ 
          success: false,
          message: "Security configuration error: hash not found" 
        });
      }

      isCorrect = userDateHash === storedHash;
    } else {
      return res.status(400).json({ 
        success: false,
        message: "Unknown security type" 
      });
    }

    console.log('🔐 Validation result:', { isCorrect, securityType });
    
    // If answer is correct, update letter status to "read" and create notification
    if (isCorrect) {
      try {
        const updates = {
          status: 'read',
          readAt: new Date().toISOString()
        };
        
        console.log('🔐 Updating letter status to "read"', { letterId, updates });
        await letterRef.update(updates);
        console.log('✅ Letter status updated to "read"');
        
        // Create notification for the sender
        try {
          const notificationRef = db.ref(`users/${userId}/notifications`).push();
          await notificationRef.set({
            type: 'letter_read',
            letterId: letterId,
            letterTitle: letter.introductory || 'Your Letter',
            message: `Your letter "${letter.introductory || 'Untitled Letter'}" has been read! 💌`,
            read: false,
            createdAt: new Date().toISOString(),
          });
          console.log('✅ Notification created for letter read');
        } catch (notificationError) {
          console.error('❌ Error creating notification:', notificationError);
          // Don't fail if notification creation fails
        }
      } catch (updateError) {
        console.error('❌ Error updating letter status:', updateError);
        // Don't fail the validation if status update fails, but log it
      }
    }
    
    const response = { 
      success: true,
      isCorrect: isCorrect,
      message: isCorrect ? "Answer is correct" : "Answer is incorrect"
    };
    console.log('🔐 Sending response:', response);
    res.status(200).json(response);
    console.log('✅ Response sent successfully');
  } catch (error) {
    console.error("❌ Error validating security answer:", error);
    console.error("❌ Error stack:", error.stack);
    res.status(500).json({ 
      success: false,
      message: "Error validating answer", 
      error: error.message 
    });
  }
});

// POST /api/letters/:userId/:letterId/regenerate-token - Regenerate token for an existing letter
// Moved here before POST /:userId to prevent route conflicts
router.post("/:userId/:letterId/regenerate-token", 
  tokenRegenerationLimiter, // ✅ Rate limiting
  verifyAuth,               // ✅ Verify user is authenticated
  verifyOwnership,          // ✅ Verify user owns the letter
  checkFirebase, 
  async (req, res) => {
    try {
      const { userId, letterId } = req.params;

      // Verify letter exists
      const letterRef = db.ref(`users/${userId}/letters/${letterId}`);
      const letterSnapshot = await letterRef.once("value");
      const letter = letterSnapshot.val();

      if (!letter) {
        return res.status(404).json({ message: "Letter not found" });
      }

    // Deactivate old token if it exists
    if (letter.accessToken) {
      const oldTokenRef = db.ref(`letterTokens/${letter.accessToken}`);
      await oldTokenRef.update({ isActive: false });
      console.log(`🔒 Deactivated old token: ${letter.accessToken.substring(0, 8)}...`);
    }

    // Generate new token
    const newToken = generateToken();
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year

    // Store new token mapping
    const tokenRef = db.ref(`letterTokens/${newToken}`);
    await tokenRef.set({
      userId: userId,
      letterId: letterId,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt,
      isActive: true
    });

    // Update letter with new token and shareable link
    // Note: Frontend will construct the full URL, we store relative path
    const shareableLink = `/letter/${newToken}`; // Relative path, frontend will add origin
    
    await letterRef.update({
      accessToken: newToken,
      shareableLink: shareableLink,
      updatedAt: new Date().toISOString()
    });

    console.log(`✅ Token regenerated for letter ${letterId}: ${newToken.substring(0, 8)}...`);

    res.status(200).json({
      message: "Token regenerated successfully",
      token: newToken,
      shareableLink: shareableLink,
      expiresAt: expiresAt
    });
  } catch (error) {
    console.error("Error regenerating token:", error);
    res.status(500).json({
      message: "Error regenerating token",
      error: error.message
    });
  }
});

// PUT /api/letters/:userId/:letterId/responses/:responseId - Update a response
router.put("/:userId/:letterId/responses/:responseId", checkFirebase, async (req, res) => {
  try {
    const { userId, letterId, responseId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: "Response content is required"
      });
    }

    // Check if letter exists
    const letterRef = db.ref(`users/${userId}/letters/${letterId}`);
    const letterSnapshot = await letterRef.once("value");
    const letter = letterSnapshot.val();

    if (!letter) {
      return res.status(404).json({
        success: false,
        message: "Letter not found"
      });
    }

    // Check if response exists
    const responseRef = db.ref(`users/${userId}/letters/${letterId}/responses/${responseId}`);
    const responseSnapshot = await responseRef.once("value");
    const response = responseSnapshot.val();

    if (!response) {
      return res.status(404).json({
        success: false,
        message: "Response not found"
      });
    }

    // Update response
    const updates = {
      content: content.trim(),
      updatedAt: new Date().toISOString()
    };

    await responseRef.update(updates);

    console.log(`✅ Response updated: ${responseId} for letter ${letterId}`);

    res.status(200).json({
      success: true,
      message: "Response updated successfully",
      response: {
        id: responseId,
        ...response,
        ...updates
      }
    });
  } catch (error) {
    console.error("Error updating response:", error);
    res.status(500).json({
      success: false,
      message: "Error updating response",
      error: error.message
    });
  }
});

// DELETE /api/letters/:userId/:letterId/responses/:responseId - Delete a response
// IMPORTANT: This route must come BEFORE /:userId/:letterId to avoid route conflicts
router.delete("/:userId/:letterId/responses/:responseId", checkFirebase, async (req, res) => {
  try {
    const { userId, letterId, responseId } = req.params;
    
    console.log(`🗑️ DELETE /api/letters/${userId}/${letterId}/responses/${responseId} - Deleting response`);

    // Check if letter exists
    const letterRef = db.ref(`users/${userId}/letters/${letterId}`);
    const letterSnapshot = await letterRef.once("value");
    const letter = letterSnapshot.val();

    if (!letter) {
      console.log(`❌ Letter not found: ${letterId} for user ${userId}`);
      return res.status(404).json({
        success: false,
        message: "Letter not found"
      });
    }

    // Check if response exists
    const responseRef = db.ref(`users/${userId}/letters/${letterId}/responses/${responseId}`);
    const responseSnapshot = await responseRef.once("value");
    const response = responseSnapshot.val();

    if (!response) {
      console.log(`❌ Response not found: ${responseId} for letter ${letterId}`);
      return res.status(404).json({
        success: false,
        message: "Response not found"
      });
    }

    // Delete response
    await responseRef.remove();

    console.log(`✅ Response deleted: ${responseId} for letter ${letterId}`);

    res.status(200).json({
      success: true,
      message: "Response deleted successfully"
    });
  } catch (error) {
    console.error("❌ Error deleting response:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Error deleting response",
      error: error.message
    });
  }
});

// GET /api/letters/:userId/:letterId/responses - Get all responses for a letter
router.get("/:userId/:letterId/responses", checkFirebase, async (req, res) => {
  try {
    const { userId, letterId } = req.params;

    // Check if letter exists
    const letterRef = db.ref(`users/${userId}/letters/${letterId}`);
    const letterSnapshot = await letterRef.once("value");
    const letter = letterSnapshot.val();

    if (!letter) {
      return res.status(404).json({
        success: false,
        message: "Letter not found"
      });
    }

    // Fetch responses
    const responsesRef = db.ref(`users/${userId}/letters/${letterId}/responses`);
    const responsesSnapshot = await responsesRef.once("value");
    const responses = responsesSnapshot.val();

    if (!responses) {
      return res.status(200).json([]);
    }

    // Convert object to array
    const responsesArray = Object.keys(responses).map(key => ({
      id: key,
      ...responses[key]
    }));

    res.status(200).json(responsesArray);
  } catch (error) {
    console.error("Error fetching responses:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching responses",
      error: error.message
    });
  }
});

// GET /api/letters/:userId/:letterId/voice-messages - Get all voice messages for a letter
router.get("/:userId/:letterId/voice-messages", checkFirebase, async (req, res) => {
  try {
    const { userId, letterId } = req.params;

    // Check if letter exists
    const letterRef = db.ref(`users/${userId}/letters/${letterId}`);
    const letterSnapshot = await letterRef.once("value");
    const letter = letterSnapshot.val();

    if (!letter) {
      return res.status(404).json({
        success: false,
        message: "Letter not found"
      });
    }

    // Fetch voice messages
    const voiceMessagesRef = db.ref(`users/${userId}/letters/${letterId}/voiceMessages`);
    const voiceMessagesSnapshot = await voiceMessagesRef.once("value");
    const voiceMessages = voiceMessagesSnapshot.val();

    if (!voiceMessages) {
      return res.status(200).json([]);
    }

    // Convert object to array
    const voiceMessagesArray = Object.keys(voiceMessages).map(key => ({
      id: key,
      ...voiceMessages[key]
    }));

    res.status(200).json(voiceMessagesArray);
  } catch (error) {
    console.error("Error fetching voice messages:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching voice messages",
      error: error.message
    });
  }
});

// DELETE /api/letters/:userId/:letterId/voice-messages/:recordingId - Delete a voice message
router.delete("/:userId/:letterId/voice-messages/:recordingId", checkFirebase, async (req, res) => {
  try {
    const { userId, letterId, recordingId } = req.params;
    const { fileName } = req.body;

    // Check if letter exists
    const letterRef = db.ref(`users/${userId}/letters/${letterId}`);
    const letterSnapshot = await letterRef.once("value");
    const letter = letterSnapshot.val();

    if (!letter) {
      return res.status(404).json({
        success: false,
        message: "Letter not found"
      });
    }

    // Delete from Firebase Realtime Database
    const voiceMessageRef = db.ref(`users/${userId}/letters/${letterId}/voiceMessages/${recordingId}`);
    await voiceMessageRef.remove();

    // Delete from Firebase Storage if fileName is provided
    if (fileName && storage) {
      try {
        const fileRef = storage.file(fileName);
        const exists = await fileRef.exists();
        if (exists[0]) {
          await fileRef.delete();
          console.log(`✅ Voice message file deleted from storage: ${fileName}`);
        }
      } catch (storageError) {
        console.error("⚠️ Warning: Failed to delete voice message from storage:", storageError);
        // Don't fail the request if storage deletion fails
      }
    }

    res.status(200).json({
      success: true,
      message: "Voice message deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting voice message:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting voice message",
      error: error.message
    });
  }
});

// POST /api/letters/:userId/:letterId/responses - Save a response to a letter
// Moved here before POST /:userId to prevent route conflicts
router.post("/:userId/:letterId/responses", checkFirebase, async (req, res) => {
  try {
    const { userId, letterId } = req.params;
    const { content, receiverName } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: "Response content is required"
      });
    }

    // Check if letter exists
    const letterRef = db.ref(`users/${userId}/letters/${letterId}`);
    const letterSnapshot = await letterRef.once("value");
    const letter = letterSnapshot.val();

    if (!letter) {
      return res.status(404).json({
        success: false,
        message: "Letter not found"
      });
    }

    // Create response object
    const response = {
      content: content.trim(),
      receiverName: receiverName || letter.receiverName || "Friend",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save response under responses node
    const responsesRef = db.ref(`users/${userId}/letters/${letterId}/responses`);
    const newResponseRef = responsesRef.push();
    await newResponseRef.set(response);

    const responseId = newResponseRef.key;

    console.log(`✅ Response saved for letter ${letterId}:`, {
      responseId,
      receiverName: response.receiverName,
      contentLength: response.content.length
    });

    // Create notification for sender when receiver writes back
    try {
      const notificationsRef = db.ref(`users/${userId}/notifications`);
      const notificationRef = notificationsRef.push();
      await notificationRef.set({
        type: "letter_response",
        letterId: letterId,
        letterTitle: letter.introductory || letter.title || 'Your Letter',
        receiverName: response.receiverName || letter.receiverName || 'Your loved one',
        message: `${response.receiverName || letter.receiverName || 'Your loved one'} wrote back to your letter "${letter.introductory || letter.title || 'Untitled Letter'}"! 💌`,
        read: false,
        createdAt: new Date().toISOString(),
      });
      console.log(`✅ Notification created for letter response from ${response.receiverName}`);
    } catch (notificationError) {
      console.error("❌ Error creating letter response notification:", notificationError);
      // Don't fail the request if notification creation fails
    }

    res.status(200).json({
      success: true,
      message: "Response saved successfully",
      response: {
        id: responseId,
        ...response
      }
    });
  } catch (error) {
    console.error("Error saving response:", error);
    res.status(500).json({
      success: false,
      message: "Error saving response",
      error: error.message
    });
  }
});

// POST /api/letters/:userId - Create a new letter
// NOTE: This route must come AFTER all specific routes like /validate-security, /regenerate-token, etc.
router.post("/:userId", checkFirebase, async (req, res) => {
  // Debug: Log if this route is being hit when it shouldn't be
  if (req.path.includes('validate-security') || req.path.includes('regenerate-token') || req.path.includes('responses')) {
    console.error('⚠️ WARNING: POST /:userId route matched when it should not have! Path:', req.path);
    return res.status(404).json({ 
      message: "Route not found - this should have matched a more specific route",
      path: req.path
    });
  }
  try {
    const { userId } = req.params;
    const { 
      content, 
      receiverEmail, 
      receiverName,
      introductory, 
      mainBody, 
      closing, 
      introductoryStyle,
      mainBodyStyle,
      closingStyle,
      securityType, 
      securityConfig,
      selectedMusic, // Legacy support - Can be a preset ID or uploaded music URL
      letterMusic, // Music for letter viewing (new field)
      dashboardMusic // Music for dashboard (array, new field)
    } = req.body;

    // Support both old format (single content) and new format (3-part structure)
    let finalContent = content;
    
    // If separate parts are provided, combine them
    if (introductory || mainBody || closing) {
      const parts = [];
      if (introductory && introductory.trim()) parts.push(introductory.trim());
      if (mainBody && mainBody.trim()) parts.push(mainBody.trim());
      if (closing && closing.trim()) parts.push(closing.trim());
      finalContent = parts.join('\n\n');
    }

    if (!finalContent || !finalContent.trim()) {
      return res.status(400).json({ 
        message: "Letter content is required" 
      });
    }

    // Security: Only log full request body in development
    if (process.env.NODE_ENV === 'development') {
      console.log('📥 FULL REQUEST BODY:', JSON.stringify(req.body, null, 2));
    }
    console.log('📥 Extracted values:', {
      hasIntroductoryStyle: introductoryStyle !== undefined,
      introductoryStyle,
      introductoryStyleType: typeof introductoryStyle,
      hasMainBodyStyle: mainBodyStyle !== undefined,
      mainBodyStyle,
      mainBodyStyleType: typeof mainBodyStyle,
      hasClosingStyle: closingStyle !== undefined,
      closingStyle,
      closingStyleType: typeof closingStyle,
      hasSecurityType: securityType !== undefined,
      securityType,
      securityTypeType: typeof securityType,
      hasSecurityConfig: securityConfig !== undefined,
      securityConfig,
      securityConfigType: typeof securityConfig
    });

    const newLetter = {
      content: finalContent.trim(),
      receiverEmail: receiverEmail || "",
      receiverName: receiverName || "",
      status: "unread", // unread, read
      readAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Store separate parts if provided (for future use)
    if (introductory !== undefined) newLetter.introductory = introductory.trim();
    if (mainBody !== undefined) newLetter.mainBody = mainBody.trim();
    if (closing !== undefined) newLetter.closing = closing.trim();
    
    // Store animation styles - ALWAYS save if defined (including 0, null, etc.)
    if (introductoryStyle !== undefined) {
      newLetter.introductoryStyle = typeof introductoryStyle === 'string' ? parseInt(introductoryStyle, 10) : Number(introductoryStyle);
    }
    if (mainBodyStyle !== undefined) {
      newLetter.mainBodyStyle = typeof mainBodyStyle === 'string' ? parseInt(mainBodyStyle, 10) : Number(mainBodyStyle);
    }
    if (closingStyle !== undefined) {
      newLetter.closingStyle = typeof closingStyle === 'string' ? parseInt(closingStyle, 10) : Number(closingStyle);
    }
    
    // Store security configuration - ALWAYS save if defined
    if (securityType !== undefined) {
      const securityTypeStr = String(securityType).trim();
      if (securityTypeStr !== '' && securityTypeStr !== 'null' && securityTypeStr !== 'undefined') {
        newLetter.securityType = securityTypeStr;
      }
    }
    
    // Save securityConfig - ALWAYS save if defined and securityType is set
    // IMPORTANT: Hash the answers before saving for security
    if (securityConfig !== undefined && newLetter.securityType) {
      if (typeof securityConfig === 'object' && securityConfig !== null) {
        // Create a secure copy of the config with hashed answers
        const secureConfig = { ...securityConfig };
        
        // Hash the correct answer based on security type
        if (newLetter.securityType === 'quiz' && secureConfig.correctAnswer) {
          // For quiz: hash the correctAnswer
          secureConfig.correctAnswerHash = hashAnswer(secureConfig.correctAnswer);
          // Remove the plain text answer - NEVER save it
          delete secureConfig.correctAnswer;
          console.log('🔒 Hashed quiz answer (original removed)');
        } else if (newLetter.securityType === 'date' && secureConfig.correctDate) {
          // For date: hash the correctDate (normalize date format first)
          const dateStr = String(secureConfig.correctDate).trim();
          secureConfig.correctDateHash = hashAnswer(dateStr);
          // Remove the plain text date - NEVER save it
          delete secureConfig.correctDate;
          console.log('🔒 Hashed date answer (original removed)');
        }
        
        // Keep question and other metadata (not sensitive)
        newLetter.securityConfig = secureConfig;
      } else if (securityConfig !== null) {
        // Try to parse if it's a string
        try {
          const parsed = typeof securityConfig === 'string' ? JSON.parse(securityConfig) : securityConfig;
          if (typeof parsed === 'object' && !Array.isArray(parsed)) {
            const secureConfig = { ...parsed };
            if (newLetter.securityType === 'quiz' && secureConfig.correctAnswer) {
              secureConfig.correctAnswerHash = hashAnswer(secureConfig.correctAnswer);
              delete secureConfig.correctAnswer;
            } else if (newLetter.securityType === 'date' && secureConfig.correctDate) {
              secureConfig.correctDateHash = hashAnswer(secureConfig.correctDate);
              delete secureConfig.correctDate;
            }
            newLetter.securityConfig = secureConfig;
          } else {
            newLetter.securityConfig = parsed;
          }
        } catch (e) {
          console.warn('⚠️ Could not parse securityConfig, saving as-is:', typeof securityConfig);
          newLetter.securityConfig = securityConfig;
        }
      }
    }
    
    // Store selected music (legacy support - preset ID or uploaded music URL)
    if (selectedMusic !== undefined && selectedMusic !== null && selectedMusic !== "") {
      newLetter.selectedMusic = selectedMusic;
    }
    
    // Store letter music (new field - music for letter viewing)
    if (letterMusic !== undefined && letterMusic !== null && letterMusic !== "") {
      newLetter.letterMusic = letterMusic;
    }
    
    // Store dashboard music (new field - array of music URLs for dashboard)
    if (dashboardMusic !== undefined && dashboardMusic !== null) {
      if (Array.isArray(dashboardMusic) && dashboardMusic.length > 0) {
        newLetter.dashboardMusic = dashboardMusic;
      } else if (!Array.isArray(dashboardMusic) && dashboardMusic !== "") {
        // Convert single value to array for backward compatibility
        newLetter.dashboardMusic = [dashboardMusic];
      }
    }
    
    // EXPLICITLY ensure title is NOT saved (remove if somehow added)
    delete newLetter.title;
    
    // Log what will be saved
    console.log('📝 newLetter object before save (keys only):', Object.keys(newLetter));
    console.log('📝 Security fields in newLetter:', {
      hasSecurityType: 'securityType' in newLetter,
      securityType: newLetter.securityType,
      hasSecurityConfig: 'securityConfig' in newLetter,
      securityConfig: newLetter.securityConfig
    });
    console.log('📝 Animation fields in newLetter:', {
      hasIntroductoryStyle: 'introductoryStyle' in newLetter,
      introductoryStyle: newLetter.introductoryStyle,
      hasMainBodyStyle: 'mainBodyStyle' in newLetter,
      mainBodyStyle: newLetter.mainBodyStyle,
      hasClosingStyle: 'closingStyle' in newLetter,
      closingStyle: newLetter.closingStyle
    });

    // Debug logging
    console.log('📝 Saving letter with config:');
    console.log('  - Animation Styles:', {
      introductoryStyle,
      mainBodyStyle,
      closingStyle
    });
    console.log('  - Security Preferences:', {
      securityType: securityType || 'none',
      hasSecurityConfig: !!securityConfig,
      securityConfig: securityConfig ? {
        question: securityConfig.question || 'N/A',
        answer: securityConfig.correctAnswer || securityConfig.correctDate || 'N/A',
        questionType: securityConfig.questionType || 'N/A'
      } : null
    });
    // Security: Only log full letter object in development
    if (process.env.NODE_ENV === 'development') {
      console.log('📝 Full letter object being saved:', JSON.stringify(newLetter, null, 2));
    }
    console.log('📝 Security fields in newLetter:', {
      hasSecurityType: 'securityType' in newLetter,
      securityType: newLetter.securityType,
      hasSecurityConfig: 'securityConfig' in newLetter,
      securityConfig: newLetter.securityConfig
    });

    const lettersRef = db.ref(`users/${userId}/letters`);
    const newLetterRef = lettersRef.push();
    const letterId = newLetterRef.key;
    
    console.log('💾 About to save letter with ID:', letterId);
    console.log('💾 newLetter object before save:', JSON.stringify(newLetter, null, 2));
    
    await newLetterRef.set(newLetter);

    // Generate secure token for shareable link
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year expiration
    
    // Store token mapping
    const tokenRef = db.ref(`letterTokens/${token}`);
    await tokenRef.set({
      userId: userId,
      letterId: letterId,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt,
      isActive: true
    });
    
    // Store token in letter for reference (optional, for revocation)
    await newLetterRef.update({ accessToken: token });

    // Query the database immediately after saving to verify
    console.log('🔍 Querying database to verify saved data...');
    const savedSnapshot = await newLetterRef.once("value");
    const savedData = savedSnapshot.val();
    
    if (!savedData) {
      console.error('❌ ERROR: No data found in database after save!');
    } else {
      console.log('✅ Database query successful - Letter ID:', letterId);
      console.log('✅ All fields in saved letter:', Object.keys(savedData));
      console.log('✅ Security fields verification:', {
        hasSecurityType: 'securityType' in savedData,
        securityType: savedData.securityType,
        securityTypeValue: savedData.securityType,
        hasSecurityConfig: 'securityConfig' in savedData,
        securityConfig: savedData.securityConfig,
        securityConfigType: typeof savedData.securityConfig,
        securityConfigKeys: savedData.securityConfig ? Object.keys(savedData.securityConfig) : null
      });
      console.log('✅ Animation fields verification:', {
        hasIntroductoryStyle: 'introductoryStyle' in savedData,
        introductoryStyle: savedData.introductoryStyle,
        hasMainBodyStyle: 'mainBodyStyle' in savedData,
        mainBodyStyle: savedData.mainBodyStyle,
        hasClosingStyle: 'closingStyle' in savedData,
        closingStyle: savedData.closingStyle
      });
      console.log('✅ Full saved letter data:', JSON.stringify(savedData, null, 2));
      
      // Also query the parent node to see all letters
      const allLettersSnapshot = await lettersRef.once("value");
      const allLetters = allLettersSnapshot.val();
      console.log('📚 All letters for user:', Object.keys(allLetters || {}));
    }

    // Make sure title is not in the response either
    const responseLetter = { id: newLetterRef.key, ...newLetter };
    delete responseLetter.title;
    
    console.log('📤 Response being sent:', {
      id: responseLetter.id,
      hasTitle: 'title' in responseLetter,
      hasSecurityType: 'securityType' in responseLetter,
      hasSecurityConfig: 'securityConfig' in responseLetter,
      hasIntroductoryStyle: 'introductoryStyle' in responseLetter,
      hasMainBodyStyle: 'mainBodyStyle' in responseLetter,
      hasClosingStyle: 'closingStyle' in responseLetter,
      token: token
    });
    
    res.status(201).json({ 
      message: "Letter created successfully",
      letter: responseLetter,
      token: token // Include token in response
    });
  } catch (error) {
    console.error("Error creating letter:", error);
    res.status(500).json({ 
      message: "Error creating letter", 
      error: error.message 
    });
  }
});

// PUT /api/letters/:userId/:letterId - Update a letter
router.put("/:userId/:letterId", checkFirebase, async (req, res) => {
  try {
    const { userId, letterId } = req.params;
    const { content, introductory, mainBody, closing, shareableLink, reaction, emailSent, emailSentTo, emailScheduled, scheduledDateTime, selectedMusic, letterMusic, dashboardMusic } = req.body;

    const letterRef = db.ref(`users/${userId}/letters/${letterId}`);
    const snapshot = await letterRef.once("value");
    const letter = snapshot.val();

    if (!letter) {
      return res.status(404).json({ message: "Letter not found" });
    }

    const updates = {
      updatedAt: new Date().toISOString(),
    };

    // Save shareable link if provided
    if (shareableLink !== undefined && shareableLink !== null) {
      updates.shareableLink = String(shareableLink).trim();
    }

    // Save emailSent flag if provided
    if (emailSent !== undefined) {
      updates.emailSent = Boolean(emailSent);
      if (emailSent && emailSentTo) {
        updates.emailSentTo = String(emailSentTo).trim().toLowerCase();
        updates.emailSentAt = new Date().toISOString();
      }
    }

    // Save emailScheduled flag if provided
    if (emailScheduled !== undefined) {
      updates.emailScheduled = Boolean(emailScheduled);
    }

    // Save scheduledDateTime if provided - validate it's in the future
    if (scheduledDateTime !== undefined && scheduledDateTime !== null) {
      const scheduledDate = new Date(scheduledDateTime);
      const now = new Date();
      
      // Validate date format
      if (isNaN(scheduledDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid scheduled date/time format",
          error: "The scheduled date/time provided is not valid",
        });
      }
      
      // Validate that scheduled date/time is in the future
      if (scheduledDate <= now) {
        return res.status(400).json({
          success: false,
          message: "Scheduled date and time must be in the future",
          error: "Cannot schedule an email for a past date/time",
        });
      }
      
      updates.scheduledDateTime = scheduledDateTime;
      
      // If the letter has an emailSentTo and shareableLink, update the corresponding scheduled email entry
      // This ensures the cron job picks up the updated time
      if (letter.emailSentTo && letter.shareableLink && emailScheduled !== false) {
        try {
          const scheduledEmailsRef = db.ref('scheduledEmails');
          const scheduledEmailsSnapshot = await scheduledEmailsRef.once('value');
          const scheduledEmails = scheduledEmailsSnapshot.val();
          
          if (scheduledEmails) {
            // Find the scheduled email entry matching this letter
            const matchingEmailId = Object.keys(scheduledEmails).find(emailId => {
              const email = scheduledEmails[emailId];
              return email.recipientEmail === letter.emailSentTo && 
                     email.shareableLink === letter.shareableLink &&
                     email.status === 'pending';
            });
            
            if (matchingEmailId) {
              // Update the scheduled email entry with new date/time
              const emailRef = db.ref(`scheduledEmails/${matchingEmailId}`);
              await emailRef.update({
                scheduledDateTime: scheduledDateTime,
                updatedAt: new Date().toISOString()
              });
              console.log(`✅ Updated scheduled email ${matchingEmailId} with new date/time: ${scheduledDateTime}`);
            } else {
              // No matching scheduled email found - this might be a new schedule
              // We'll create one if needed (when email is sent/scheduled)
              console.log(`ℹ️ No matching scheduled email found for letter ${letterId} - will be created on next email schedule`);
            }
          }
        } catch (scheduledEmailError) {
          console.error('⚠️ Error updating scheduled email entry:', scheduledEmailError);
          // Don't fail the letter update if scheduled email update fails
        }
      }
    }

    // Save reaction if provided (only save once, don't overwrite if already exists)
    if (reaction !== undefined && reaction !== null) {
      // Check if reaction already exists - if it does, don't overwrite
      if (!letter.reaction) {
        updates.reaction = reaction;
        updates.reactionSubmittedAt = new Date().toISOString();
      }
    }

    // Support both old format and new 3-part format
    if (introductory !== undefined || mainBody !== undefined || closing !== undefined) {
      // Combine separate parts
      const parts = [];
      const intro = introductory !== undefined ? introductory : letter.introductory;
      const body = mainBody !== undefined ? mainBody : letter.mainBody;
      const close = closing !== undefined ? closing : letter.closing;
      
      if (intro && intro.trim()) parts.push(intro.trim());
      if (body && body.trim()) parts.push(body.trim());
      if (close && close.trim()) parts.push(close.trim());
      
      updates.content = parts.join('\n\n');
      
      // Store separate parts
      if (introductory !== undefined) updates.introductory = introductory.trim();
      if (mainBody !== undefined) updates.mainBody = mainBody.trim();
      if (closing !== undefined) updates.closing = closing.trim();
    } else if (content !== undefined) {
      updates.content = content.trim();
    }

    // Update selected music (legacy support)
    if (selectedMusic !== undefined) {
      if (selectedMusic !== null && selectedMusic !== "") {
        updates.selectedMusic = selectedMusic;
      } else {
        updates.selectedMusic = null;
      }
    }

    // Update letter music (new field - music for letter viewing)
    if (letterMusic !== undefined) {
      if (letterMusic !== null && letterMusic !== "") {
        updates.letterMusic = letterMusic;
      } else {
        updates.letterMusic = null;
      }
    }

    // Update dashboard music (new field - array of music URLs for dashboard)
    if (dashboardMusic !== undefined) {
      if (dashboardMusic !== null) {
        if (Array.isArray(dashboardMusic) && dashboardMusic.length > 0) {
          updates.dashboardMusic = dashboardMusic;
        } else if (!Array.isArray(dashboardMusic) && dashboardMusic !== "") {
          // Convert single value to array for backward compatibility
          updates.dashboardMusic = [dashboardMusic];
        } else {
          updates.dashboardMusic = [];
        }
      } else {
        updates.dashboardMusic = [];
      }
    }

    await letterRef.update(updates);

    res.status(200).json({ 
      message: "Letter updated successfully",
      letter: { id: letterId, ...letter, ...updates }
    });
  } catch (error) {
    console.error("Error updating letter:", error);
    res.status(500).json({ 
      message: "Error updating letter", 
      error: error.message 
    });
  }
});

// PUT /api/letters/:userId/:letterId/mark-read - Mark a letter as read
router.put("/:userId/:letterId/mark-read", checkFirebase, async (req, res) => {
  try {
    const { userId, letterId } = req.params;

    const letterRef = db.ref(`users/${userId}/letters/${letterId}`);
    const snapshot = await letterRef.once("value");
    const letter = snapshot.val();

    if (!letter) {
      return res.status(404).json({ message: "Letter not found" });
    }

    const updates = {
      status: "read",
      readAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await letterRef.update(updates);

    res.status(200).json({ 
      message: "Letter marked as read",
      letter: { id: letterId, ...letter, ...updates }
    });
  } catch (error) {
    console.error("Error marking letter as read:", error);
    res.status(500).json({ 
      message: "Error marking letter as read", 
      error: error.message 
    });
  }
});

router.delete("/:userId/:letterId", checkFirebase, async (req, res) => {
  try {
    const { userId, letterId } = req.params;

    const letterRef = db.ref(`users/${userId}/letters/${letterId}`);
    const snapshot = await letterRef.once("value");
    const letter = snapshot.val();

    if (!letter) {
      return res.status(404).json({ message: "Letter not found" });
    }

    // Delete the associated letter token if it exists
    if (letter.accessToken) {
      try {
        const tokenRef = db.ref(`letterTokens/${letter.accessToken}`);
        await tokenRef.remove();
        console.log(`✅ Deleted token for letter ${letterId}: ${letter.accessToken.substring(0, 8)}...`);
      } catch (tokenError) {
        console.error("Error deleting letter token:", tokenError);
        // Continue with letter deletion even if token deletion fails
      }
    }

    await letterRef.remove();

    res.status(200).json({ 
      message: "Letter deleted successfully",
      letterId: letterId
    });
  } catch (error) {
    console.error("Error deleting letter:", error);
    res.status(500).json({ 
      message: "Error deleting letter", 
      error: error.message 
    });
  }
});

// Log route registration on module load
console.log('✅ Letters routes registered:');
console.log('  - POST /:userId/:letterId/validate-security (line ~194)');
console.log('  - POST /:userId/:letterId/regenerate-token (line ~282)');
console.log('  - POST /:userId/:letterId/responses (line ~350)');
console.log('  - POST /:userId (line ~417) - MUST be after specific routes');

module.exports = router;

