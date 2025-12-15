// API endpoint for managing receiver accounts and linking letters
const express = require("express");
const router = express.Router();
const { db } = require("../configs/firebase");
const { verifyAuth } = require("../middleware/auth");

// Middleware to check if Firebase is initialized
const checkFirebase = (req, res, next) => {
  if (!db) {
    return res.status(503).json({ 
      success: false,
      error: "Firebase is not configured. Please set up Firebase credentials." 
    });
  }
  next();
};

// POST /api/receiver-accounts/link
// Link a receiver account to letters they've accessed via token
router.post("/link", checkFirebase, async (req, res) => {
  try {
    const { receiverEmail, letterId, senderUserId, token } = req.body;

    if (!receiverEmail || !letterId || !senderUserId) {
      return res.status(400).json({
        success: false,
        error: "receiverEmail, letterId, and senderUserId are required"
      });
    }

    console.log('🔗 Linking receiver account:', { receiverEmail, letterId, senderUserId });

    // Find user by email in Firebase Auth (we need to query users to find matching email)
    // Since we can't directly query Firebase Auth by email from backend easily,
    // we'll search through users in database
    const usersRef = db.ref('users');
    const usersSnapshot = await usersRef.once('value');
    const users = usersSnapshot.val() || {};

    let receiverUserId = null;
    // Find user with matching email
    for (const [userId, userData] of Object.entries(users)) {
      if (userData && userData.email && userData.email.toLowerCase().trim() === receiverEmail.toLowerCase().trim()) {
        receiverUserId = userId;
        break;
      }
    }

    if (!receiverUserId) {
      return res.status(404).json({
        success: false,
        error: "Receiver account not found. Please make sure you've created an account with this email."
      });
    }

    // Verify the letter exists and belongs to the sender
    const letterRef = db.ref(`users/${senderUserId}/letters/${letterId}`);
    const letterSnapshot = await letterRef.once('value');
    const letter = letterSnapshot.val();

    if (!letter) {
      return res.status(404).json({
        success: false,
        error: "Letter not found"
      });
    }

    // Verify receiver email matches
    if (letter.receiverEmail && letter.receiverEmail.toLowerCase().trim() !== receiverEmail.toLowerCase().trim()) {
      return res.status(403).json({
        success: false,
        error: "Email does not match the letter receiver"
      });
    }

    // Create or update received letter entry
    const receivedLettersRef = db.ref(`users/${receiverUserId}/receivedLetters/${letterId}`);
    const existingReceivedLetter = await receivedLettersRef.once('value');
    const existingData = existingReceivedLetter.val();

    const receivedLetterData = {
      senderUserId: senderUserId,
      senderName: letter.receiverName || 'Unknown', // Note: This might need to be sender's name
      letterTitle: letter.introductory || letter.mainBody?.substring(0, 50) || 'Untitled Letter',
      accessedAt: existingData?.accessedAt || new Date().toISOString(),
      readAt: letter.status === 'read' ? letter.readAt || new Date().toISOString() : null,
      linkedVia: token ? 'token' : 'email',
      originalToken: token || null,
      status: letter.status || 'unread',
      linkedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await receivedLettersRef.set(receivedLetterData);

    // Update token to link to account if token provided
    if (token) {
      try {
        const tokenRef = db.ref(`letterTokens/${token}`);
        await tokenRef.update({
          linkedToAccount: receiverUserId,
          linkedAt: new Date().toISOString()
        });
      } catch (tokenError) {
        console.warn('⚠️ Could not update token link:', tokenError);
        // Don't fail if token update fails
      }
    }

    console.log('✅ Successfully linked letter to receiver account:', { receiverUserId, letterId });

    res.status(200).json({
      success: true,
      message: "Letter linked to account successfully",
      data: {
        receiverUserId,
        letterId,
        senderUserId
      }
    });
  } catch (error) {
    console.error("❌ Error linking receiver account:", error);
    res.status(500).json({
      success: false,
      error: "Error linking account",
      details: error.message
    });
  }
});

// GET /api/receiver-accounts/letters/:userId
// Get all letters received by a user
router.get("/letters/:userId", checkFirebase, async (req, res) => {
  try {
    const { userId } = req.params;

    const receivedLettersRef = db.ref(`users/${userId}/receivedLetters`);
    const snapshot = await receivedLettersRef.once('value');
    const receivedLetters = snapshot.val();

    if (!receivedLetters) {
      return res.status(200).json({
        success: true,
        letters: []
      });
    }

    // Convert to array and enrich with letter data
    const lettersArray = await Promise.all(
      Object.entries(receivedLetters).map(async ([letterId, receivedData]) => {
        try {
          // Fetch full letter data from sender
          const letterRef = db.ref(`users/${receivedData.senderUserId}/letters/${letterId}`);
          const letterSnapshot = await letterRef.once('value');
          const letterData = letterSnapshot.val();

          // Find token for this letter
          let token = receivedData.originalToken || null;
          if (!token) {
            // Try to find token from letterTokens
            const tokensRef = db.ref('letterTokens');
            const tokensSnapshot = await tokensRef.once('value');
            const tokens = tokensSnapshot.val() || {};
            for (const [tokenKey, tokenData] of Object.entries(tokens)) {
              if (tokenData && tokenData.userId === receivedData.senderUserId && tokenData.letterId === letterId) {
                token = tokenKey;
                break;
              }
            }
          }

          return {
            id: letterId,
            ...letterData,
            senderUserId: receivedData.senderUserId,
            senderName: receivedData.senderName,
            accessedAt: receivedData.accessedAt,
            readAt: receivedData.readAt,
            status: receivedData.status,
            linkedVia: receivedData.linkedVia,
            originalToken: token,
            token: token // Alias for easier access
          };
        } catch (error) {
          console.error(`Error fetching letter ${letterId}:`, error);
          return {
            id: letterId,
            ...receivedData,
            error: 'Could not fetch letter data'
          };
        }
      })
    );

    // Sort by accessedAt (newest first)
    lettersArray.sort((a, b) => {
      const dateA = new Date(a.accessedAt || 0);
      const dateB = new Date(b.accessedAt || 0);
      return dateB - dateA;
    });

    res.status(200).json({
      success: true,
      letters: lettersArray
    });
  } catch (error) {
    console.error("❌ Error fetching received letters:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching received letters",
      details: error.message
    });
  }
});

// POST /api/receiver-accounts/check-email
// Check if an email has received any letters (before account creation)
router.post("/check-email", checkFirebase, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required"
      });
    }

    // Search all letters to find ones sent to this email
    const usersRef = db.ref('users');
    const usersSnapshot = await usersRef.once('value');
    const users = usersSnapshot.val() || {};

    const matchingLetters = [];

    for (const [senderUserId, userData] of Object.entries(users)) {
      if (!userData || !userData.letters) continue;

      const letters = userData.letters;
      for (const [letterId, letter] of Object.entries(letters)) {
        if (letter && letter.receiverEmail && 
            letter.receiverEmail.toLowerCase().trim() === email.toLowerCase().trim()) {
          matchingLetters.push({
            letterId,
            senderUserId,
            letterTitle: letter.introductory || letter.mainBody?.substring(0, 50) || 'Untitled Letter',
            createdAt: letter.createdAt
          });
        }
      }
    }

    res.status(200).json({
      success: true,
      hasLetters: matchingLetters.length > 0,
      letterCount: matchingLetters.length,
      letters: matchingLetters
    });
  } catch (error) {
    console.error("❌ Error checking email:", error);
    res.status(500).json({
      success: false,
      error: "Error checking email",
      details: error.message
    });
  }
});

module.exports = router;

