const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const { admin, db } = require("../configs/firebase");
require('dotenv').config();

// Generate a secure random token
const generateToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Helper function to get token data from Firebase
const getTokenData = async (token) => {
  if (!db) return null;
  try {
    const tokenRef = db.ref(`emailVerificationTokens/${token}`);
    const snapshot = await tokenRef.once('value');
    return snapshot.val();
  } catch (error) {
    console.error('Error fetching token from Firebase:', error);
    return null;
  }
};

// Helper function to save token to Firebase
const saveToken = async (token, tokenData) => {
  if (!db) return false;
  try {
    const tokenRef = db.ref(`emailVerificationTokens/${token}`);
    await tokenRef.set({
      ...tokenData,
      expiresAt: tokenData.expiresAt, // Store as timestamp
    });
    return true;
  } catch (error) {
    console.error('Error saving token to Firebase:', error);
    return false;
  }
};

// Helper function to update token in Firebase
const updateToken = async (token, updates) => {
  if (!db) return false;
  try {
    const tokenRef = db.ref(`emailVerificationTokens/${token}`);
    await tokenRef.update(updates);
    return true;
  } catch (error) {
    console.error('Error updating token in Firebase:', error);
    return false;
  }
};

// Helper function to delete token from Firebase
const deleteToken = async (token) => {
  if (!db) return false;
  try {
    const tokenRef = db.ref(`emailVerificationTokens/${token}`);
    await tokenRef.remove();
    return true;
  } catch (error) {
    console.error('Error deleting token from Firebase:', error);
    return false;
  }
};

// Clean up expired tokens (run every hour)
if (db) {
  setInterval(async () => {
    try {
      const now = Date.now();
      const tokensRef = db.ref('emailVerificationTokens');
      const snapshot = await tokensRef.once('value');
      const tokens = snapshot.val() || {};
      
      const deletePromises = [];
      for (const [token, data] of Object.entries(tokens)) {
        if (data && data.expiresAt && data.expiresAt < now) {
          deletePromises.push(deleteToken(token));
        }
      }
      
      if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
        console.log(`🧹 Cleaned up ${deletePromises.length} expired email verification tokens`);
      }
    } catch (error) {
      console.error('Error cleaning up expired tokens:', error);
    }
  }, 60 * 60 * 1000); // Every hour
}

// POST /api/email-verification/send
// Send verification email
router.post("/send", async (req, res) => {
  try {
    const { email, firstName, lastName, userId } = req.body;

    if (!email || !firstName || !lastName || !userId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields: email, firstName, lastName, userId" 
      });
    }

    // Save user info to Firebase Realtime Database (unverified)
    try {
      if (admin && db) {
        const userRef = db.ref(`users/${userId}`);
        await userRef.set({
          email: email,
          firstName: firstName,
          lastName: lastName,
          emailVerified: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    } catch (firebaseError) {
      console.error("Firebase error saving user:", firebaseError);
      // Continue even if Firebase fails
    }

    // Generate verification token
    const token = generateToken();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    // Store token in Firebase for persistence
    const tokenData = {
      email,
      firstName,
      lastName,
      userId,
      createdAt: Date.now(),
      expiresAt,
      used: false // Track if token has been used
    };
    
    const saved = await saveToken(token, tokenData);
    if (!saved) {
      console.warn('⚠️ Failed to save token to Firebase, but continuing...');
    }
    
    // Also store a reverse mapping: userId -> token (for idempotent checks)
    if (db) {
      try {
        const userIdMapRef = db.ref(`emailVerificationUserIdMap/${userId}`);
        await userIdMapRef.set({ token, createdAt: Date.now() });
      } catch (error) {
        console.warn('⚠️ Failed to save userId mapping:', error);
      }
    }

    // Create email transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Create verification link (URL encode the token to handle special characters)
    const encodedToken = encodeURIComponent(token);
    const CLIENT_URL = process.env.CLIENT_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');
    if (!CLIENT_URL && process.env.NODE_ENV === 'production') {
      throw new Error('CLIENT_URL environment variable is required in production');
    }
    const verificationLink = `${CLIENT_URL}/verify-email?token=${encodedToken}`;
    
    // Security: Only log in development, and anonymize email
    if (process.env.NODE_ENV === 'development') {
      console.log('Verification email being sent to:', email);
      console.log('Token generated (first 10 chars):', token.substring(0, 10) + '...');
      console.log('Verification link:', verificationLink);
    } else {
      // In production, only log anonymized email
      const anonymizedEmail = email ? `${email.split('@')[0]}@***` : 'unknown';
      console.log('Verification email being sent to:', anonymizedEmail);
    }

    // Email content
    const mailOptions = {
      from: `"Dearly 💌" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Verify your Dearly account",
      html: `
        <div style="font-family: 'Georgia', serif; max-width: 600px; margin: 0 auto; padding: 40px; background: linear-gradient(135deg, #fef3f2 0%, #fce7f3 100%); border-radius: 12px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #ec4899; font-size: 32px; margin: 0;">Dearly</h1>
            <p style="color: #6b7280; font-style: italic; margin-top: 5px;">Express your heart, beautifully</p>
          </div>
          
          <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <h2 style="color: #1f2937; font-size: 24px; margin-top: 0;">Hello ${firstName}! 👋</h2>
            
            <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
              Thank you for signing up for Dearly! We're excited to have you join our community.
            </p>
            
            <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
              Please verify your email address by clicking the button below. This link will expire in 24 hours.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationLink}" 
                 style="display: inline-block; background: linear-gradient(135deg, #ec4899 0%, #f472b6 100%); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(236, 72, 153, 0.3);">
                Verify Email Address ✉️
              </a>
            </div>
            
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
              If the button doesn't work, copy and paste this link into your browser:
            </p>
            <p style="color: #9ca3af; font-size: 12px; word-break: break-all; background: #f9fafb; padding: 10px; border-radius: 4px;">
              ${verificationLink}
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 30px; color: #9ca3af; font-size: 12px;">
            <p>Made with 💕 by Elgen for Faith</p>
            <p>If you didn't create this account, you can safely ignore this email.</p>
          </div>
        </div>
      `,
    };

    // Send email
    await transporter.sendMail(mailOptions);

    res.status(200).json({ 
      success: true, 
      message: "Verification email sent successfully" 
    });
  } catch (error) {
    console.error("Email verification error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to send verification email", 
      details: error.message 
    });
  }
});

// GET /api/email-verification/verify
// Verify email with token
router.get("/verify", async (req, res) => {
  try {
    const { token } = req.query;

    console.log('Verification request received. Token:', token ? `${token.substring(0, 10)}...` : 'missing');

    if (!token) {
      console.error('No token provided in request');
      return res.status(400).json({ 
        success: false, 
        error: "Verification token is required" 
      });
    }

    // Try to decode the token if it's URL encoded
    let decodedToken = token;
    try {
      decodedToken = decodeURIComponent(token);
    } catch (e) {
      // Token might not be encoded, use as is
      decodedToken = token;
    }
    
    // Check if token exists in Firebase (try both encoded and decoded versions)
    let tokenData = await getTokenData(decodedToken);
    if (!tokenData) {
      tokenData = await getTokenData(token);
    }

    // If token not found, return error (can't check user without userId from token)
    if (!tokenData) {
      console.error('Token not found in database.');
      console.error('Received token (first 20 chars):', token.substring(0, 20));
      console.error('Decoded token (first 20 chars):', decodedToken.substring(0, 20));
      
      return res.status(400).json({ 
        success: false, 
        error: "This verification link is no longer valid. It may have expired or already been used. If you've already verified your email, you can sign in. Otherwise, please request a new verification email. 💌"
      });
    }
    
    // Check if token was already used (idempotent operation)
    if (tokenData.used) {
      console.log('Token already used, checking if user is verified...');
      // Check if user is already verified in Firebase
      try {
        if (admin && db) {
          const userRef = db.ref(`users/${tokenData.userId}`);
          const snapshot = await userRef.once('value');
          const userData = snapshot.val();
          if (userData && userData.emailVerified === true) {
            console.log('User already verified, returning success (idempotent)');
            return res.status(200).json({ 
              success: true, 
              message: "Email already verified",
              user: {
                email: tokenData.email,
                firstName: tokenData.firstName,
                lastName: tokenData.lastName
              }
            });
          }
        }
      } catch (firebaseError) {
        console.error("Firebase error checking verification:", firebaseError);
      }
      
      return res.status(400).json({ 
        success: false, 
        error: "This verification link has already been used. If you've already verified your email, you can sign in." 
      });
    }

    // Check if token has expired
    if (Date.now() > tokenData.expiresAt) {
      // Clean up expired token
      await deleteToken(decodedToken);
      if (decodedToken !== token) {
        await deleteToken(token);
      }
      return res.status(400).json({ 
        success: false, 
        error: "This verification link has expired. Please request a new verification email to continue. The link is valid for 24 hours. 💌"
      });
    }

    // Check if user is already verified (idempotent operation)
    let alreadyVerified = false;
    try {
      if (admin && db) {
        const userRef = db.ref(`users/${tokenData.userId}`);
        const snapshot = await userRef.once('value');
        const userData = snapshot.val();
        if (userData && userData.emailVerified === true) {
          alreadyVerified = true;
          console.log('User already verified, returning success');
        }
      }
    } catch (firebaseError) {
      console.error("Firebase error checking verification status:", firebaseError);
    }

    // Update user's email verification status in Firebase (only if not already verified)
    if (!alreadyVerified) {
      try {
        if (admin && db) {
          const userRef = db.ref(`users/${tokenData.userId}`);
          // Update only the verification status and verifiedAt timestamp
          await userRef.update({
            emailVerified: true,
            verifiedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          console.log('User verification status updated in Firebase');
        }
      } catch (firebaseError) {
        console.error("Firebase error updating verification:", firebaseError);
        // Continue even if Firebase fails - we'll still mark as verified
      }
    }

    // Mark token as used instead of deleting (allows idempotent verification)
    await updateToken(decodedToken, { used: true, usedAt: Date.now() });
    if (decodedToken !== token) {
      await updateToken(token, { used: true, usedAt: Date.now() });
    }
    console.log('Token marked as used after successful verification');

    res.status(200).json({ 
      success: true, 
      message: "Email verified successfully",
      user: {
        email: tokenData.email,
        firstName: tokenData.firstName,
        lastName: tokenData.lastName
      }
    });
  } catch (error) {
    console.error("Email verification error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to verify email", 
      details: error.message 
    });
  }
});

module.exports = router;

