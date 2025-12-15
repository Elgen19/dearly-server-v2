// Vercel serverless function entry point
// This exports the Express app for Vercel's serverless environment

// Set Vercel environment flag before requiring index
process.env.VERCEL = '1';

const app = require('../index');

// Export the Express app for Vercel
module.exports = app;
