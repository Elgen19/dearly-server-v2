// Firebase Admin SDK Configuration
require('dotenv').config();

// Suppress Firebase SDK warnings EARLY - before any Firebase modules are loaded
// This prevents warnings from being emitted during module initialization
const originalWarn = console.warn;
const originalError = console.error;

// Helper to check if message is an empty Firebase warning
const isFirebaseEmptyWarning = (args) => {
  if (args.length === 0) return false;
  
  // Convert all args to strings for pattern matching
  const message = args.map(arg => {
    if (typeof arg === 'string') return arg;
    if (typeof arg === 'object' && arg !== null) {
      // Check if it's an empty object
      if (Object.keys(arg).length === 0) return '{}';
      // Try to stringify for pattern matching
      try {
        return JSON.stringify(arg);
      } catch (e) {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
  
  // Check if message contains Firebase warning pattern with empty object
  if (message.includes('@firebase/database') && 
      message.includes('FIREBASE WARNING') && 
      (message.includes('{}') || message.trim().endsWith('FIREBASE WARNING:'))) {
    return true;
  }
  
  return false;
};

console.warn = function(...args) {
  if (isFirebaseEmptyWarning(args)) {
    return; // Suppress empty Firebase warnings
  }
  originalWarn.apply(console, args);
};

console.error = function(...args) {
  if (isFirebaseEmptyWarning(args)) {
    return; // Suppress empty Firebase warnings
  }
  originalError.apply(console, args);
};

let admin = null;
let db = null;
let storage = null;

try {
  admin = require("firebase-admin");
} catch (error) {
  console.warn("⚠️ firebase-admin package not installed. Run 'npm install' in letter-server directory.");
  module.exports = { admin: null, db: null };
  return;
}

// Initialize Firebase Admin SDK
// Option 1: Using service account JSON file (recommended for local dev)
// Uncomment and update path if using service account file:
/*
const serviceAccount = require("../path-to-your-service-account-key.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});
*/

// Option 2: Using environment variables (recommended for production)
// Set these in your .env file:
// FIREBASE_PROJECT_ID=your-project-id
// FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
// FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
// FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com

if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
  try {
    console.log("🔧 Initializing Firebase Admin SDK...");
    console.log("📋 Firebase Config:", {
      projectId: process.env.FIREBASE_PROJECT_ID ? "✅ Set" : "❌ Missing",
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? "✅ Set" : "❌ Missing",
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL ? "✅ Set" : "❌ Missing",
      databaseURL: process.env.FIREBASE_DATABASE_URL ? `✅ ${process.env.FIREBASE_DATABASE_URL}` : "❌ Missing",
    });
    
    // Ensure database URL doesn't have trailing slash
    let databaseURL = process.env.FIREBASE_DATABASE_URL;
    if (databaseURL && databaseURL.endsWith('/')) {
      databaseURL = databaseURL.slice(0, -1);
      console.log('🔧 Removed trailing slash from database URL');
    }
    
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
      databaseURL: databaseURL,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
    db = admin.database();
    
    if (!db) {
      console.error("❌ Firebase database() returned null");
    } else {
      console.log("✅ Firebase Database initialized successfully");
      
      // Set database emulator if in development (optional)
      try {
        if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
          console.log(`🔧 Using Firebase Database emulator: ${process.env.FIREBASE_DATABASE_EMULATOR_HOST}`);
        }
      } catch (emulatorError) {
        // Ignore emulator setup errors
      }
      
      // Warning suppression is already set up at the top of the file
      // This ensures warnings are caught even during module initialization
    }
    
    // Initialize Firebase Storage if bucket is configured
    if (process.env.FIREBASE_STORAGE_BUCKET) {
      try {
        storage = admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET);
        console.log(`✅ Firebase Storage initialized successfully with bucket: ${process.env.FIREBASE_STORAGE_BUCKET}`);
      } catch (error) {
        console.error("❌ Error initializing Firebase Storage:", error);
        console.error("❌ Error details:", {
          message: error.message,
          bucket: process.env.FIREBASE_STORAGE_BUCKET,
        });
        storage = null;
      }
    } else {
      console.warn("⚠️ FIREBASE_STORAGE_BUCKET not set in .env file. File uploads will not work.");
    }
    
    console.log("✅ Firebase Admin SDK initialized successfully");
  } catch (error) {
    console.error("❌ Error initializing Firebase Admin SDK:", error);
    console.error("❌ Error stack:", error.stack);
    db = null;
  }
} else {
  console.warn("⚠️ Firebase credentials not found. Date invitation features will not work.");
  console.warn("⚠️ Required env vars: FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL, FIREBASE_DATABASE_URL");
}

// Helper function to test database connection
async function testDatabaseConnection() {
  if (!db) {
    return { connected: false, error: "Database not initialized" };
  }
  
  try {
    // Try to read from a non-existent path (will succeed even if empty)
    // This tests if we can connect to Firebase
    const testRef = db.ref('.info/connected');
    const snapshot = await Promise.race([
      testRef.once('value'),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection test timeout')), 3000)
      )
    ]);
    return { connected: true, value: snapshot.val() };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

// Test connection on startup (async, don't block)
if (db) {
  setTimeout(async () => {
    console.log('🔍 Testing Firebase database connection...');
    const testResult = await testDatabaseConnection();
    if (testResult.connected) {
      console.log('✅ Firebase database connection test passed');
    } else {
      console.error('❌ Firebase database connection test FAILED:', testResult.error);
      console.error('⚠️  DIAGNOSTIC INFORMATION:');
      console.error('   1. Check if database URL is correct:', process.env.FIREBASE_DATABASE_URL);
      console.error('   2. Verify service account credentials are valid and not expired');
      console.error('   3. Check network/firewall allows connections to *.firebaseio.com');
      console.error('   4. Ensure Firebase Realtime Database is enabled in Firebase Console');
      console.error('   5. Verify service account has "Firebase Realtime Database Admin" role');
      console.error('   6. Check Firebase Status: https://status.firebase.google.com/');
      console.error('   NOTE: Firebase Admin SDK bypasses database rules, so rules are NOT the issue');
      console.error('   All Firebase operations will timeout until connectivity is restored.');
    }
  }, 2000); // Wait 2 seconds after initialization
}

module.exports = { admin, db, storage, testDatabaseConnection };

