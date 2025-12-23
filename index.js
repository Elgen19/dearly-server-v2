const express = require("express");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const emailRoutes = require("./api/send-email");
const dateInvitationsRoutes = require("./api/date-invitations");
const emailVerificationRoutes = require("./api/email-verification");
const authRoutes = require("./api/auth");
const receiverDataRoutes = require("./api/receiver-data");
const lettersRoutes = require("./api/letters");
const musicUploadRoutes = require("./api/music-upload");
const letterEmailRoutes = require("./api/letter-email");
const voiceUploadRoutes = require("./api/voice-upload");
const audioProxyRoutes = require("./api/audio-proxy");
const notificationsRoutes = require("./api/notifications");
const gamePrizesRoutes = require("./api/game-prizes");
const quizzesRoutes = require("./api/quizzes");
const gamesRoutes = require("./api/games");
const receiverAccountsRoutes = require("./api/receiver-accounts");
const { initializeEmailScheduler } = require("./jobs/emailScheduler");
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Security: Validate required environment variables
const requiredEnvVars = ['FIREBASE_PROJECT_ID', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_DATABASE_URL'];
if (NODE_ENV === 'production') {
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    console.error('❌ CRITICAL: Missing required environment variables:', missingVars.join(', '));
    process.exit(1);
  }
}

// Security: Add security headers
app.use(helmet({
  contentSecurityPolicy: NODE_ENV === 'production' ? undefined : false, // Disable in dev for easier debugging
  crossOriginEmbedderPolicy: false, // Allow embedding if needed
  crossOriginOpenerPolicy: false, // Allow popups for Firebase Auth (client already sets unsafe-none)
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: 'deny' }, // Prevent clickjacking
  noSniff: true, // Prevent MIME type sniffing
  xssFilter: true, // Enable XSS filter
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// Security: Configure CORS - restrict to production domain in production
const allowedOrigins = NODE_ENV === 'production' 
  ? (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : [])
  : ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://127.0.0.1:3000'];

if (NODE_ENV === 'production' && allowedOrigins.length === 0) {
  console.error('❌ CRITICAL: ALLOWED_ORIGINS environment variable must be set in production');
  process.exit(1);
}

// Enhanced CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }
    
    // Always allow localhost origins (for local development, regardless of NODE_ENV)
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return callback(null, true);
    }
    
    // In development mode, allow all origins
    if (NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    // Check if origin is in allowed list (case-insensitive)
    const originLower = origin.toLowerCase();
    const isAllowed = allowedOrigins.some(allowed => allowed.toLowerCase() === originLower);
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`⚠️ CORS blocked origin: ${origin} (NODE_ENV: ${NODE_ENV})`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200 // Some legacy browsers (IE11, various SmartTVs) choke on 204
}));

// Handle preflight OPTIONS requests explicitly (Express 5.x compatible)
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    // Always allow localhost for OPTIONS requests
    if (!origin || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      res.header('Access-Control-Allow-Origin', origin || '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
      res.header('Access-Control-Allow-Credentials', 'true');
      return res.sendStatus(200);
    }
    // For other origins, check if allowed
    const originLower = origin.toLowerCase();
    const isAllowed = allowedOrigins.some(allowed => allowed.toLowerCase() === originLower) || NODE_ENV === 'development';
    if (isAllowed) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
      res.header('Access-Control-Allow-Credentials', 'true');
      return res.sendStatus(200);
    }
  }
  next();
});

// Security: Limit request body size to prevent DoS attacks
app.use(express.json({ limit: '10mb' })); // Limit JSON payload to 10MB
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Limit URL-encoded payload

// Serve uploaded music files as static files
// Files will be accessible at: http://your-server:5000/uploads/music/filename
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
app.use("/api/send-email", emailRoutes);
app.use("/api/date-invitations", dateInvitationsRoutes);
app.use("/api/email-verification", emailVerificationRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/receiver-data", receiverDataRoutes);
app.use("/api/letters", lettersRoutes);
app.use("/api/music-upload", musicUploadRoutes);
app.use("/api/letter-email", letterEmailRoutes);
app.use("/api/voice-upload", voiceUploadRoutes);
app.use("/api/audio-proxy", audioProxyRoutes);
// Security: Disable debug/test endpoints in production
if (NODE_ENV === 'development') {
  const pdfTestRoutes = require("./api/pdf-test");
  app.use("/api/pdf-test", pdfTestRoutes);
}
app.use("/api/notifications", notificationsRoutes);
app.use("/api/game-prizes", gamePrizesRoutes);
app.use("/api/quizzes", quizzesRoutes);
app.use("/api/games", gamesRoutes);
app.use("/api/receiver-accounts", receiverAccountsRoutes);

// Cron job endpoint (handled by Express, not separate Vercel function)
const emailSchedulerHandler = require("./api/cron/email-scheduler");
app.get("/api/cron/email-scheduler", emailSchedulerHandler);

// Log registered routes for debugging (only in development)
if (NODE_ENV === 'development') {
  console.log('📋 Registered API routes:');
  console.log('  - POST /api/auth/save-google-user');
  console.log('  - GET /api/auth/check-verification/:userId');
}

// Health check endpoint for Render
app.get('/api/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'letter-server',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV
  });
});

// Export app for Vercel serverless functions
// Only start server if not in Vercel environment
if (process.env.VERCEL !== '1') {
  // Start server (for local development or traditional hosting)
  app.listen(PORT, () => {
    if (NODE_ENV === 'development') {
      console.log(`✅ Server running on http://localhost:${PORT}`);
    } else {
      console.log(`✅ Server running on port ${PORT} (${NODE_ENV})`);
    }
    
    // Initialize email scheduler cron job (only for traditional server)
    initializeEmailScheduler();
  });
} else {
  // In Vercel, initialize scheduler on cold start
  // Note: Cron jobs should be handled via Vercel Cron Jobs (see vercel.json)
  if (NODE_ENV === 'development') {
    console.log('✅ Express app ready for Vercel serverless');
  }
}

// Export the Express app for Vercel
module.exports = app;
