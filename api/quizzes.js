// API endpoint for love quizzes
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

// POST /api/quizzes/:userId - Create a new quiz
router.post("/:userId", checkFirebase, async (req, res) => {
  try {
    const { userId } = req.params;
    const { title, questions, settings } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    if (!title || !questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: "Title and at least one question are required" });
    }

    const quiz = {
      title,
      questions,
      settings: settings || {
        timeLimitPerQuestion: 60,
        passingScore: 70,
        numWrongAnswers: 3,
      },
      createdAt: new Date().toISOString(),
      createdBy: userId,
    };

    // Store in Firebase: users/{userId}/quizzes/{quizId}
    const quizzesRef = db.ref(`users/${userId}/quizzes`);
    const newQuizRef = quizzesRef.push();
    await newQuizRef.set(quiz);

    const quizId = newQuizRef.key;

    console.log(`✅ Quiz created for user ${userId}:`, { quizId, title });

    res.status(201).json({
      success: true,
      quizId,
      quiz,
    });
  } catch (error) {
    console.error("❌ Error creating quiz:", error);
    res.status(500).json({ error: "Failed to create quiz" });
  }
});

// GET /api/quizzes/:userId - Get all quizzes for a user
router.get("/:userId", checkFirebase, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const quizzesRef = db.ref(`users/${userId}/quizzes`);
    const snapshot = await quizzesRef.once("value");
    const quizzes = snapshot.val();

    if (!quizzes) {
      return res.status(200).json({ quizzes: [] });
    }

    // Convert to array and sort by createdAt (newest first)
    const quizzesArray = Object.entries(quizzes).map(([id, data]) => ({
      id,
      ...data,
    }));

    quizzesArray.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0);
      const dateB = new Date(b.createdAt || 0);
      return dateB - dateA;
    });

    res.status(200).json({ quizzes: quizzesArray });
  } catch (error) {
    console.error("❌ Error fetching quizzes:", error);
    res.status(500).json({ error: "Failed to fetch quizzes" });
  }
});

// GET /api/quizzes/:userId/:quizId - Get a specific quiz
router.get("/:userId/:quizId", checkFirebase, async (req, res) => {
  try {
    const { userId, quizId } = req.params;

    if (!userId || !quizId) {
      return res.status(400).json({ error: "User ID and Quiz ID are required" });
    }

    const quizRef = db.ref(`users/${userId}/quizzes/${quizId}`);
    const snapshot = await quizRef.once("value");
    const quiz = snapshot.val();

    if (!quiz) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    res.status(200).json({ quiz: { id: quizId, ...quiz } });
  } catch (error) {
    console.error("❌ Error fetching quiz:", error);
    res.status(500).json({ error: "Failed to fetch quiz" });
  }
});

// PUT /api/quizzes/:userId/:quizId - Update a quiz
router.put("/:userId/:quizId", checkFirebase, async (req, res) => {
  try {
    const { userId, quizId } = req.params;
    const { title, questions, settings } = req.body;

    if (!userId || !quizId) {
      return res.status(400).json({ error: "User ID and Quiz ID are required" });
    }

    if (!title || !questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: "Title and at least one question are required" });
    }

    // Check if quiz exists
    const quizRef = db.ref(`users/${userId}/quizzes/${quizId}`);
    const snapshot = await quizRef.once("value");
    const existingQuiz = snapshot.val();

    if (!existingQuiz) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    // Update quiz
    const updatedQuiz = {
      ...existingQuiz,
      title,
      questions,
      settings: settings || existingQuiz.settings,
      updatedAt: new Date().toISOString(),
    };

    await quizRef.update(updatedQuiz);

    console.log(`✅ Quiz updated for user ${userId}:`, { quizId, title });

    res.status(200).json({
      success: true,
      quizId,
      quiz: updatedQuiz,
    });
  } catch (error) {
    console.error("❌ Error updating quiz:", error);
    res.status(500).json({ error: "Failed to update quiz" });
  }
});

// DELETE /api/quizzes/:userId/:quizId - Delete a quiz
router.delete("/:userId/:quizId", checkFirebase, async (req, res) => {
  try {
    const { userId, quizId } = req.params;

    if (!userId || !quizId) {
      return res.status(400).json({ error: "User ID and Quiz ID are required" });
    }

    // Check if quiz exists
    const quizRef = db.ref(`users/${userId}/quizzes/${quizId}`);
    const snapshot = await quizRef.once("value");
    const quiz = snapshot.val();

    if (!quiz) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    // Delete quiz
    await quizRef.remove();

    console.log(`✅ Quiz deleted for user ${userId}:`, { quizId });

    res.status(200).json({
      success: true,
      message: "Quiz deleted successfully",
    });
  } catch (error) {
    console.error("❌ Error deleting quiz:", error);
    res.status(500).json({ error: "Failed to delete quiz" });
  }
});

// POST /api/quizzes/:userId/:quizId/submit - Submit quiz results
router.post("/:userId/:quizId/submit", checkFirebase, async (req, res) => {
  try {
    const { userId, quizId } = req.params;
    const { answers, timeTaken, letterId } = req.body;

    if (!userId || !quizId) {
      return res.status(400).json({ error: "User ID and Quiz ID are required" });
    }

    // Get the quiz
    const quizRef = db.ref(`users/${userId}/quizzes/${quizId}`);
    const snapshot = await quizRef.once("value");
    const quiz = snapshot.val();

    if (!quiz) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    // Calculate score
    let correctAnswers = 0;
    const results = quiz.questions.map((question, index) => {
      const userAnswer = answers[index];
      const isCorrect = userAnswer && userAnswer.toLowerCase().trim() === question.correctAnswer.toLowerCase().trim();
      if (isCorrect) correctAnswers++;
      return {
        question: question.question,
        correctAnswer: question.correctAnswer,
        userAnswer: userAnswer || '',
        isCorrect,
      };
    });

    const score = Math.round((correctAnswers / quiz.questions.length) * 100);
    const passed = score >= (quiz.settings.passingScore || 70);
    const prizeWon = passed;

    // Save quiz result
    const quizResult = {
      quizId,
      quizTitle: quiz.title,
      score,
      correctAnswers,
      totalQuestions: quiz.questions.length,
      passed,
      prizeWon,
      timeTaken: timeTaken || 0,
      results,
      letterId: letterId || null,
      submittedAt: new Date().toISOString(),
      createdAt: Date.now(),
    };

    const resultsRef = db.ref(`users/${userId}/quizResults`);
    const newResultRef = resultsRef.push();
    await newResultRef.set(quizResult);

    // If prize was won, create notification
    if (prizeWon) {
      try {
        const notificationRef = db.ref(`users/${userId}/notifications`).push();
        await notificationRef.set({
          type: 'quiz_prize_won',
          quizId: quizId,
          quizTitle: quiz.title,
          resultId: newResultRef.key,
          message: `Congratulations! You passed the "${quiz.title}" quiz with a score of ${score}%! 🎁`,
          score: score,
          letterId: letterId || null,
          read: false,
          createdAt: new Date().toISOString(),
        });
        console.log('✅ Quiz prize notification created');
      } catch (notificationError) {
        console.error('❌ Error creating quiz notification:', notificationError);
        // Don't fail if notification creation fails
      }
    }

    console.log(`✅ Quiz result submitted for user ${userId}:`, {
      quizId,
      score,
      passed,
      prizeWon,
    });

    res.status(201).json({
      success: true,
      resultId: newResultRef.key,
      quizResult,
    });
  } catch (error) {
    console.error("❌ Error submitting quiz result:", error);
    res.status(500).json({ error: "Failed to submit quiz result" });
  }
});

module.exports = router;

