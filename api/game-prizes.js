// API endpoint for game prizes and wins
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

// POST /api/game-prizes/:userId - Record a game win/prize
router.post("/:userId", checkFirebase, async (req, res) => {
  try {
    const { userId } = req.params;
    const { gameType, score, difficulty, prizeWon, letterId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    if (!gameType || score === undefined) {
      return res.status(400).json({ error: "Game type and score are required" });
    }

    const gameResult = {
      gameType,
      score,
      difficulty: difficulty || null,
      prizeWon: prizeWon || false,
      letterId: letterId || null,
      timestamp: new Date().toISOString(),
      createdAt: Date.now(),
    };

    // Store in Firebase: users/{userId}/gamePrizes/{gameResultId}
    const gamePrizesRef = db.ref(`users/${userId}/gamePrizes`);
    const newGameResultRef = gamePrizesRef.push();
    await newGameResultRef.set(gameResult);

    const gameResultId = newGameResultRef.key;

    console.log(`✅ Game result recorded for user ${userId}:`, {
      gameResultId,
      gameType,
      score,
      prizeWon,
    });

    // Get game creator userId from letterId if available, otherwise use userId
    let creatorUserId = userId;
    if (letterId) {
      try {
        const letterRef = db.ref(`users/${userId}/letters/${letterId}`);
        const letterSnapshot = await letterRef.once("value");
        const letterData = letterSnapshot.val();
        // The letter creator is the one who should be notified
        // For now, we'll use the userId from the request, but this might need adjustment
        // based on your game structure
      } catch (error) {
        console.log("Could not fetch letter data for notification");
      }
    }

    // Create notification for game completion (not just prize wins)
    // The notification should go to the game creator, not the player
    // For now, we'll create it for the userId, but you may need to adjust this
    // based on your game structure (e.g., if games are shared between users)
    try {
      // Get receiver name for the notification
      let receiverName = "Your loved one";
      try {
        const receiverRef = db.ref(`users/${userId}/receiver`);
        const receiverSnapshot = await receiverRef.once("value");
        const receiverData = receiverSnapshot.val();
        if (receiverData && receiverData.name) {
          receiverName = receiverData.name;
        }
      } catch (receiverError) {
        console.log("Could not fetch receiver name for game notification");
      }

      const notificationRef = db.ref(`users/${userId}/notifications`);
      const newNotificationRef = notificationRef.push();
      await newNotificationRef.set({
        type: prizeWon ? "game_prize" : "game_completion",
        gameType: gameType,
        score: score,
        receiverName: receiverName,
        gameResultId,
        letterId: letterId || null,
        read: false,
        createdAt: new Date().toISOString(),
        timestamp: new Date().toISOString(),
      });

      console.log(`🎮 Game completion notification created for user ${userId}`);
    } catch (notifyError) {
      console.error("Error creating game completion notification:", notifyError);
    }

    res.status(201).json({
      success: true,
      gameResultId,
      gameResult,
      notificationCreated: prizeWon,
    });
  } catch (error) {
    console.error("❌ Error recording game result:", error);
    res.status(500).json({ error: "Failed to record game result" });
  }
});

// GET /api/game-prizes/:userId - Get all game results for a user
router.get("/:userId", checkFirebase, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const gamePrizesRef = db.ref(`users/${userId}/gamePrizes`);
    const snapshot = await gamePrizesRef.once("value");
    const gameResults = snapshot.val();

    if (!gameResults) {
      return res.status(200).json({ gameResults: [] });
    }

    // Convert to array and sort by timestamp (newest first)
    const resultsArray = Object.entries(gameResults).map(([id, data]) => ({
      id,
      ...data,
    }));

    resultsArray.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    res.status(200).json({ gameResults: resultsArray });
  } catch (error) {
    console.error("❌ Error fetching game results:", error);
    res.status(500).json({ error: "Failed to fetch game results" });
  }
});

// GET /api/game-prizes/:userId/prizes - Get only prize wins
router.get("/:userId/prizes", checkFirebase, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const gamePrizesRef = db.ref(`users/${userId}/gamePrizes`);
    const snapshot = await gamePrizesRef.once("value");
    const gameResults = snapshot.val();

    if (!gameResults) {
      return res.status(200).json({ prizes: [] });
    }

    // Filter only prize wins
    const prizesArray = Object.entries(gameResults)
      .map(([id, data]) => ({
        id,
        ...data,
      }))
      .filter((result) => result.prizeWon === true)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    res.status(200).json({ prizes: prizesArray });
  } catch (error) {
    console.error("❌ Error fetching prizes:", error);
    res.status(500).json({ error: "Failed to fetch prizes" });
  }
});

module.exports = router;

