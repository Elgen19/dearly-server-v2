// API endpoint for games (with rewards support)
const express = require("express");
const router = express.Router();
const { db } = require("../configs/firebase");

// Middleware to check Firebase connection
const checkFirebase = (req, res, next) => {
  if (!db) {
    console.error("❌ Firebase database not initialized");
    return res.status(500).json({ error: "Database connection failed" });
  }
  next();
};

// POST /api/games/:userId - Create a new game
router.post("/:userId", checkFirebase, async (req, res) => {
  try {
    const { userId } = req.params;
    const { title, type, questions, pairs, settings, rewards, hasReward } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    if (!title || !type) {
      return res.status(400).json({ error: "Title and type are required" });
    }

    // Validate based on game type
    if (type === 'quiz' && (!questions || !Array.isArray(questions) || questions.length === 0)) {
      return res.status(400).json({ error: "Quiz games require at least one question" });
    }

    // Memory match games don't require pairs - they use default game logic

    const game = {
      title,
      type,
      questions: type === 'quiz' ? questions : null,
      pairs: type === 'memory-match' ? pairs : null,
      settings: settings || {},
      rewards: rewards || null,
      hasReward: hasReward || false,
      createdAt: new Date().toISOString(),
      createdBy: userId,
    };

    // Store in Firebase: users/{userId}/games/{gameId}
    const gamesRef = db.ref(`users/${userId}/games`);
    const newGameRef = gamesRef.push();
    await newGameRef.set(game);

    const gameId = newGameRef.key;

    console.log(`✅ Game created for user ${userId}:`, { gameId, title, type });

    res.status(201).json({
      success: true,
      gameId,
      game: { id: gameId, ...game },
    });
  } catch (error) {
    console.error("❌ Error creating game:", error);
    res.status(500).json({ error: "Failed to create game" });
  }
});

// GET /api/games/:userId - Get all games for a user
router.get("/:userId", checkFirebase, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const gamesRef = db.ref(`users/${userId}/games`);
    const snapshot = await gamesRef.once("value");
    const games = snapshot.val();

    if (!games) {
      return res.status(200).json({ games: [] });
    }

    // Convert to array and sort by createdAt (newest first)
    const gamesArray = Object.entries(games).map(([id, data]) => ({
      id,
      ...data,
    }));

    gamesArray.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0);
      const dateB = new Date(b.createdAt || 0);
      return dateB - dateA;
    });

    res.status(200).json({ games: gamesArray });
  } catch (error) {
    console.error("❌ Error fetching games:", error);
    res.status(500).json({ error: "Failed to fetch games" });
  }
});

// GET /api/games/:userId/viewed-rewards - Get viewed reward IDs for a user
// IMPORTANT: This route must come before /:userId/:gameId to avoid route conflicts
router.get("/:userId/viewed-rewards", checkFirebase, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const viewedRewardsRef = db.ref(`users/${userId}/viewedRewards`);
    const snapshot = await viewedRewardsRef.once("value");
    const viewedRewards = snapshot.val();

    // Extract reward IDs from the stored structure
    let viewedRewardIds = [];
    if (viewedRewards) {
      viewedRewardIds = Object.keys(viewedRewards).map(key => {
        // If stored with originalId, use that; otherwise use the key
        const rewardData = viewedRewards[key];
        return (rewardData && rewardData.originalId) ? rewardData.originalId : key;
      });
    }

    console.log(`✅ Retrieved ${viewedRewardIds.length} viewed reward IDs for user ${userId}:`, viewedRewardIds);

    res.status(200).json({
      success: true,
      viewedRewardIds,
    });
  } catch (error) {
    console.error("❌ Error fetching viewed rewards:", error);
    res.status(500).json({ error: "Failed to fetch viewed rewards" });
  }
});

// PUT /api/games/:userId/viewed-rewards - Update viewed reward IDs for a user
// IMPORTANT: This route must come before /:userId/:gameId to avoid route conflicts
router.put("/:userId/viewed-rewards", checkFirebase, async (req, res) => {
  try {
    const { userId } = req.params;
    const { viewedRewardIds } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    if (!Array.isArray(viewedRewardIds)) {
      return res.status(400).json({ error: "viewedRewardIds must be an array" });
    }

    console.log(`📝 Saving ${viewedRewardIds.length} viewed reward IDs for user ${userId}:`, viewedRewardIds);

    const viewedRewardsRef = db.ref(`users/${userId}/viewedRewards`);
    
    // Clear existing viewed rewards
    await viewedRewardsRef.remove();

    // Add new viewed reward IDs
    if (viewedRewardIds.length > 0) {
      const updates = {};
      viewedRewardIds.forEach(rewardId => {
        // Use rewardId as key, but sanitize it (remove special chars that might cause issues)
        const sanitizedKey = rewardId.replace(/[.#$[\]]/g, '_');
        updates[sanitizedKey] = {
          viewedAt: new Date().toISOString(),
          originalId: rewardId, // Store original ID for reference
        };
      });
      await viewedRewardsRef.update(updates);
      console.log(`✅ Saved viewed rewards to database:`, Object.keys(updates));
    }

    res.status(200).json({
      success: true,
      message: "Viewed rewards updated successfully",
      viewedRewardIds,
    });
  } catch (error) {
    console.error("❌ Error updating viewed rewards:", error);
    res.status(500).json({ error: "Failed to update viewed rewards" });
  }
});

// GET /api/games/:userId/:gameId - Get a specific game
router.get("/:userId/:gameId", checkFirebase, async (req, res) => {
  try {
    const { userId, gameId } = req.params;

    if (!userId || !gameId) {
      return res.status(400).json({ error: "User ID and Game ID are required" });
    }

    const gameRef = db.ref(`users/${userId}/games/${gameId}`);
    const snapshot = await gameRef.once("value");
    const game = snapshot.val();

    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    res.status(200).json({ game: { id: gameId, ...game } });
  } catch (error) {
    console.error("❌ Error fetching game:", error);
    res.status(500).json({ error: "Failed to fetch game" });
  }
});

// PUT /api/games/:userId/:gameId - Update a game
router.put("/:userId/:gameId", checkFirebase, async (req, res) => {
  try {
    const { userId, gameId } = req.params;
    const { title, type, questions, pairs, settings, rewards, hasReward } = req.body;

    if (!userId || !gameId) {
      return res.status(400).json({ error: "User ID and Game ID are required" });
    }

    // Check if game exists
    const gameRef = db.ref(`users/${userId}/games/${gameId}`);
    const snapshot = await gameRef.once("value");
    const existingGame = snapshot.val();

    if (!existingGame) {
      return res.status(404).json({ error: "Game not found" });
    }

    // Build update object - only include fields that are being updated
    const updateData = {
      updatedAt: new Date().toISOString(),
    };

    // Only add fields that are explicitly provided (not undefined)
    if (title !== undefined) {
      updateData.title = title;
    }
    if (type !== undefined) {
      updateData.type = type;
    }
    if (questions !== undefined) {
      updateData.questions = questions;
    }
    if (pairs !== undefined) {
      updateData.pairs = pairs;
    }
    if (settings !== undefined) {
      updateData.settings = settings;
    }
    if (rewards !== undefined) {
      updateData.rewards = rewards;
    }
    if (hasReward !== undefined) {
      updateData.hasReward = hasReward;
    }

    // Filter out any undefined values (safety check)
    const filteredUpdate = Object.fromEntries(
      Object.entries(updateData).filter(([_, value]) => value !== undefined)
    );

    await gameRef.update(filteredUpdate);

    // Get updated game for response
    const updatedSnapshot = await gameRef.once("value");
    const updatedGame = updatedSnapshot.val();

    console.log(`✅ Game updated for user ${userId}:`, { gameId, title: updatedGame.title });

    res.status(200).json({
      success: true,
      gameId,
      game: updatedGame,
    });
  } catch (error) {
    console.error("❌ Error updating game:", error);
    res.status(500).json({ error: "Failed to update game" });
  }
});

// DELETE /api/games/:userId/:gameId - Delete a game
router.delete("/:userId/:gameId", checkFirebase, async (req, res) => {
  try {
    const { userId, gameId } = req.params;

    if (!userId || !gameId) {
      return res.status(400).json({ error: "User ID and Game ID are required" });
    }

    // Check if game exists
    const gameRef = db.ref(`users/${userId}/games/${gameId}`);
    const snapshot = await gameRef.once("value");
    const game = snapshot.val();

    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    // Delete game
    await gameRef.remove();

    console.log(`✅ Game deleted for user ${userId}:`, { gameId });

    res.status(200).json({
      success: true,
      message: "Game deleted successfully",
    });
  } catch (error) {
    console.error("❌ Error deleting game:", error);
    res.status(500).json({ error: "Failed to delete game" });
  }
});

// POST /api/games/:userId/:gameId/complete - Mark a game as completed
router.post("/:userId/:gameId/complete", checkFirebase, async (req, res) => {
  try {
    const { userId, gameId } = req.params;
    const { passed, rewardId, message } = req.body;

    if (!userId || !gameId) {
      return res.status(400).json({ error: "User ID and Game ID are required" });
    }

    // Check if game exists
    const gameRef = db.ref(`users/${userId}/games/${gameId}`);
    const snapshot = await gameRef.once("value");
    const existingGame = snapshot.val();

    if (!existingGame) {
      return res.status(404).json({ error: "Game not found" });
    }

    // Update game with completion status
    const updateData = {
      isCompleted: true,
      passed: passed !== undefined ? passed : true,
      completedAt: new Date().toISOString(),
    };

    if (rewardId) {
      updateData.claimedRewardId = rewardId;
    }

    if (message) {
      updateData.completionMessage = message;
      updateData.messageSentAt = new Date().toISOString();
    }

    await gameRef.update(updateData);

    // Get updated game for response
    const updatedSnapshot = await gameRef.once("value");
    const updatedGame = updatedSnapshot.val();

    console.log(`✅ Game marked as completed for user ${userId}:`, { gameId, passed, hasReward: existingGame.hasReward });

    // Create notification if game has rewards and user passed
    if (existingGame.hasReward && passed) {
      try {
        // Get receiver name if available
        let receiverName = "Your loved one";
        try {
          const receiverRef = db.ref(`users/${userId}/receiver`);
          const receiverSnapshot = await receiverRef.once("value");
          const receiverData = receiverSnapshot.val();
          if (receiverData && receiverData.name) {
            receiverName = receiverData.name;
          }
        } catch (receiverError) {
          console.log("Could not fetch receiver name, using default");
        }

        // Find the reward name if rewardId is provided
        let rewardName = null;
        if (rewardId && existingGame.rewards && Array.isArray(existingGame.rewards)) {
          // Try multiple methods to find the claimed reward
          const claimedReward = existingGame.rewards.find((r, idx) => {
            return r.id === rewardId || 
                   r._id === rewardId ||
                   r.name === rewardId ||
                   `reward_index_${idx}` === rewardId ||
                   String(idx) === String(rewardId);
          });
          if (claimedReward && claimedReward.name) {
            rewardName = claimedReward.name;
          }
        }

        // Get game type for formatting
        const gameType = existingGame.type === 'quiz' ? 'Quiz Game' : 
                        existingGame.type === 'memory-match' ? 'Memory Match' : 
                        existingGame.type || 'Game';

        // Create notification message
        let notificationMessage = `${receiverName} passed the ${gameType}`;
        if (rewardName) {
          notificationMessage += ` and selected reward: "${rewardName}"`;
        } else if (rewardId) {
          notificationMessage += ` and selected a reward`;
        }
        notificationMessage += ` 🎁`;

        // Create notification in Firebase
        const notificationsRef = db.ref(`users/${userId}/notifications`);
        const notificationRef = notificationsRef.push();
        await notificationRef.set({
          type: "game_completion",
          gameId: gameId,
          gameType: existingGame.type || 'game',
          gameTitle: existingGame.title || 'Game',
          passed: passed,
          rewardId: rewardId || null,
          rewardName: rewardName || null,
          receiverName: receiverName,
          message: notificationMessage,
          read: false,
          createdAt: new Date().toISOString(),
        });

        console.log(`✅ Notification created for game completion:`, {
          gameId,
          gameTitle: existingGame.title,
          gameType: existingGame.type,
          passed: passed,
          rewardId: rewardId || null,
          rewardName: rewardName || null,
          hasReward: existingGame.hasReward,
          receiverName: receiverName
        });
      } catch (notificationError) {
        console.error("❌ Error creating game completion notification:", notificationError);
        // Don't fail the request if notification creation fails
      }
    }

    res.status(200).json({
      success: true,
      gameId,
      game: { id: gameId, ...updatedGame },
    });
  } catch (error) {
    console.error("❌ Error marking game as completed:", error);
    res.status(500).json({ error: "Failed to mark game as completed" });
  }
});

// PUT /api/games/:userId/:gameId/complete - Update game completion (message, fulfillment status, etc.)
router.put("/:userId/:gameId/complete", checkFirebase, async (req, res) => {
  try {
    const { userId, gameId } = req.params;
    const { message, rewardFulfilled, emailToReceiver, emailMessage, receiverEmail } = req.body;

    if (!userId || !gameId) {
      return res.status(400).json({ error: "User ID and Game ID are required" });
    }

    // Check if game exists
    const gameRef = db.ref(`users/${userId}/games/${gameId}`);
    const snapshot = await gameRef.once("value");
    const existingGame = snapshot.val();

    if (!existingGame) {
      return res.status(404).json({ error: "Game not found" });
    }

    const updateData = {};

    // Update message if provided
    if (message) {
      updateData.completionMessage = message;
      updateData.messageSentAt = new Date().toISOString();
    }

    // Update fulfillment status if provided
    if (rewardFulfilled !== undefined) {
      updateData.rewardFulfilled = rewardFulfilled;
      updateData.fulfilledAt = rewardFulfilled ? new Date().toISOString() : null;
    }

    // Update database
    if (Object.keys(updateData).length > 0) {
      await gameRef.update(updateData);
    }

    // Send email if requested
    if (emailToReceiver && receiverEmail && emailMessage) {
      try {
        const nodemailer = require("nodemailer");
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
          },
        });

        // Get receiver name if available
        let receiverName = "there";
        try {
          const receiverRef = db.ref(`users/${userId}/receiver`);
          const receiverSnapshot = await receiverRef.once("value");
          const receiverData = receiverSnapshot.val();
          if (receiverData && receiverData.name) {
            receiverName = receiverData.name;
          }
        } catch (receiverError) {
          console.log("Could not fetch receiver name, using default");
        }

        // Get sender's first name if available
        let senderFirstName = "Your sender";
        try {
          const userRef = db.ref(`users/${userId}`);
          const userSnapshot = await userRef.once("value");
          const userData = userSnapshot.val();
          if (userData && userData.firstName) {
            senderFirstName = userData.firstName;
          }
        } catch (senderError) {
          console.log("Could not fetch sender first name, using default");
        }

        // Get reward name if available
        let rewardName = "your reward";
        if (existingGame.rewards && Array.isArray(existingGame.rewards) && existingGame.claimedRewardId) {
          const claimedReward = existingGame.rewards.find((r, idx) => {
            return r.id === existingGame.claimedRewardId || 
                   r._id === existingGame.claimedRewardId ||
                   `reward_index_${idx}` === existingGame.claimedRewardId;
          });
          if (claimedReward && claimedReward.name) {
            rewardName = claimedReward.name;
          }
        }

        const mailOptions = {
          from: `"Dearly 💌" <${process.env.EMAIL_USER}>`,
          to: receiverEmail,
          subject: `Your reward "${rewardName}" has been fulfilled! 🎁`,
          html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Reward Fulfilled</title>
            </head>
            <body style="margin: 0; padding: 0; font-family: 'Georgia', 'Times New Roman', serif; background: linear-gradient(135deg, #fef3f2 0%, #fce7f3 50%, #fae8ff 100%);">
              <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #fef3f2 0%, #fce7f3 50%, #fae8ff 100%); padding: 40px 20px;">
                <tr>
                  <td align="center">
                    <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background: linear-gradient(135deg, rgba(254, 243, 242, 0.95) 0%, rgba(252, 231, 243, 0.95) 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2); backdrop-filter: blur(10px);">
                      <!-- Header -->
                      <tr>
                        <td align="center" style="padding: 40px 30px 30px; background: linear-gradient(135deg, rgba(236, 72, 153, 0.1) 0%, rgba(251, 113, 133, 0.1) 100%);">
                          <div style="text-align: center;">
                            <h1 style="color: #ec4899; font-size: 36px; margin: 0; font-weight: bold; letter-spacing: 2px;">Dearly</h1>
                            <p style="color: #9f1239; font-size: 14px; margin: 8px 0 0; font-style: italic; letter-spacing: 1px;">Express your heart, beautifully</p>
                          </div>
                        </td>
                      </tr>

                      <!-- Main Content -->
                      <tr>
                        <td style="padding: 40px 30px;">
                          <div style="background: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);">
                            <!-- Greeting -->
                            <h2 style="color: #1f2937; font-size: 28px; margin: 0 0 20px; font-weight: normal; line-height: 1.4;">
                              Hi ${receiverName}! 💖
                            </h2>

                            <!-- Message -->
                            <p style="color: #4b5563; font-size: 17px; line-height: 1.8; margin: 0 0 24px;">
                              ${emailMessage}
                            </p>

                            <!-- Reward Display -->
                            <div style="margin: 30px 0; padding: 20px; background: linear-gradient(135deg, #fef3f2 0%, #fce7f3 100%); border-radius: 8px; border: 2px solid #ec4899;">
                              <p style="font-size: 18px; font-weight: bold; color: #ec4899; margin: 0;">🎁 ${rewardName}</p>
                            </div>

                            <!-- Signature -->
                            <p style="margin-top: 30px; font-size: 16px; color: #555; line-height: 1.6;">
                              With love,<br/>
                              <strong style="color: #ec4899;">${senderFirstName} 💝</strong>
                            </p>
                          </div>
                        </td>
                      </tr>

                      <!-- Footer -->
                      <tr>
                        <td align="center" style="padding: 30px; background: rgba(255, 255, 255, 0.9); border-top: 1px solid rgba(236, 72, 153, 0.2);">
                          <p style="color: #4b5563; font-size: 14px; margin: 0; line-height: 1.8; font-weight: 500;">
                            Made with <span style="color: #ec4899; font-size: 16px;">❤️</span> by <strong style="color: #ec4899;">${senderFirstName}</strong> for <strong style="color: #ec4899;">${receiverName}</strong>
                          </p>
                          <p style="color: #9ca3af; font-size: 12px; margin: 8px 0 0; line-height: 1.6;">
                            If you didn't expect this email, you can safely ignore it.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </body>
            </html>
          `,
        };

        await transporter.sendMail(mailOptions);
        console.log(`✅ Fulfillment email sent to ${receiverEmail} for game ${gameId}`);
      } catch (emailError) {
        console.error("❌ Error sending fulfillment email:", emailError);
        // Don't fail the request if email fails - still update the status
      }
    }

    // Get updated game for response
    const updatedSnapshot = await gameRef.once("value");
    const updatedGame = updatedSnapshot.val();

    console.log(`✅ Game completion updated for user ${userId}:`, { gameId, rewardFulfilled, emailSent: emailToReceiver });

    res.status(200).json({
      success: true,
      gameId,
      game: { id: gameId, ...updatedGame },
    });
  } catch (error) {
    console.error("❌ Error updating game completion:", error);
    res.status(500).json({ error: "Failed to update game completion" });
  }
});

// GET /api/games/:userId/:gameId/completion - Get game completion data
router.get("/:userId/:gameId/completion", checkFirebase, async (req, res) => {
  try {
    const { userId, gameId } = req.params;

    if (!userId || !gameId) {
      return res.status(400).json({ error: "User ID and Game ID are required" });
    }

    const gameRef = db.ref(`users/${userId}/games/${gameId}`);
    const snapshot = await gameRef.once("value");
    const game = snapshot.val();

    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    res.status(200).json({
      completed: game.isCompleted || false,
      passed: game.passed || false,
      score: game.score || null,
      message: game.completionMessage || null,
      completedAt: game.completedAt || null,
      messageSentAt: game.messageSentAt || null,
      claimedRewardId: game.claimedRewardId || null,
      rewardFulfilled: game.rewardFulfilled || false,
      fulfilledAt: game.fulfilledAt || null,
    });
  } catch (error) {
    console.error("❌ Error fetching game completion data:", error);
    res.status(500).json({ error: "Failed to fetch game completion data" });
  }
});

module.exports = router;

