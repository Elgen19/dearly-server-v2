/**
 * Helper script to get Gmail API refresh token
 * 
 * Usage:
 * 1. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in your .env or replace below
 * 2. Run: node scripts/get-gmail-refresh-token.js
 * 3. Follow the instructions to authorize and get refresh token
 * 4. Add the refresh token to your .env file
 * 
 * IMPORTANT: Delete this file after getting your token (for security)
 */

require('dotenv').config();
const { google } = require('googleapis');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Get credentials from env or use placeholders
const CLIENT_ID = process.env.GMAIL_CLIENT_ID || 'YOUR_CLIENT_ID';
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || 'YOUR_CLIENT_SECRET';
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'; // For installed apps

if (CLIENT_ID === 'YOUR_CLIENT_ID' || CLIENT_SECRET === 'YOUR_CLIENT_SECRET') {
  console.error('\n❌ Error: Please set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env or replace in this file\n');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Generate auth URL
const scopes = ['https://www.googleapis.com/auth/gmail.send'];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: scopes,
  prompt: 'consent', // Force consent to get refresh token
});

console.log('\n📧 Gmail API Refresh Token Generator\n');
console.log('='.repeat(60));
console.log('\n1. Visit this URL to authorize:');
console.log('\n' + authUrl + '\n');
console.log('2. Sign in with your Gmail account');
console.log('3. Click "Allow" to grant permissions');
console.log('4. After authorization, you\'ll get a code');
console.log('5. Paste the code below:\n');
console.log('='.repeat(60) + '\n');

rl.question('Enter the authorization code: ', (code) => {
  oauth2Client.getToken(code, (err, token) => {
    if (err) {
      console.error('\n❌ Error getting token:', err.message);
      console.error('\nCommon issues:');
      console.error('- Code expired (codes expire quickly, try again)');
      console.error('- Invalid code (make sure you copied the entire code)');
      console.error('- Client ID/Secret mismatch');
      rl.close();
      return;
    }
    
    if (!token.refresh_token) {
      console.error('\n⚠️  Warning: No refresh token received!');
      console.error('This can happen if you\'ve already authorized this app before.');
      console.error('Try revoking access in your Google Account settings and try again.');
      if (token.access_token) {
        console.log('\nAccess token (expires soon):', token.access_token);
      }
      rl.close();
      return;
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ SUCCESS! Copy these to your .env file:\n');
    console.log('GMAIL_CLIENT_ID=' + CLIENT_ID);
    console.log('GMAIL_CLIENT_SECRET=' + CLIENT_SECRET);
    console.log('GMAIL_REFRESH_TOKEN=' + token.refresh_token);
    console.log('\n' + '='.repeat(60));
    console.log('\n⚠️  SECURITY: Keep these tokens secure!');
    console.log('⚠️  Never commit them to git!\n');
    
    rl.close();
  });
});

