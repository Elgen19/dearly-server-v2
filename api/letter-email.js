// letter-email.js - API endpoint for sending letter share links via email
const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");
const { db } = require("../configs/firebase");
require('dotenv').config();

// POST /api/letter-email/send - Send letter link via email
router.post("/send", async (req, res) => {
  try {
    const { recipientEmail, recipientName, senderName, shareableLink, letterTitle, scheduledDateTime } = req.body;

    if (!recipientEmail || !shareableLink) {
      return res.status(400).json({
        success: false,
        error: "Recipient email and shareable link are required",
      });
    }

    // If scheduled, validate the scheduled date/time
    if (scheduledDateTime) {
      const scheduledDate = new Date(scheduledDateTime);
      const now = new Date();
      
      if (isNaN(scheduledDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: "Invalid scheduled date/time format",
        });
      }
      
      if (scheduledDate <= now) {
        return res.status(400).json({
          success: false,
          error: "Scheduled date/time must be in the future",
        });
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

    // Default values
    const receiverName = recipientName || "there";
    const sender = senderName || "Someone special";
    const title = letterTitle || "A special letter for you";

    // Custom Dearly email template
    const mailOptions = {
      from: `"Dearly 💌" <${process.env.EMAIL_USER}>`,
      to: recipientEmail,
      subject: `💌 ${sender} has a letter for you`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>A letter for you</title>
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
                          Hello ${receiverName} 💕
                        </h2>

                        <!-- Romantic Message (replacing the introductory statement) -->
                        <p style="color: #4b5563; font-size: 17px; line-height: 1.8; margin: 0 0 24px; font-style: italic;">
                          In the quiet moments between heartbeats, someone has poured their heart into words meant only for you.
                        </p>

                        <p style="color: #4b5563; font-size: 17px; line-height: 1.8; margin: 0 0 24px; font-style: italic;">
                          A letter awaits, carrying emotions that words alone cannot express. It's a piece of someone's soul, wrapped in digital parchment, waiting to touch your heart.
                        </p>

                        <p style="color: #6b7280; font-size: 16px; line-height: 1.7; margin: 0 0 40px; font-style: italic; text-align: center;">
                          ✨ Open it when you're ready to feel something beautiful ✨
                        </p>

                        <!-- CTA Button -->
                        <div style="text-align: center; margin: 40px 0;">
                          <a href="${shareableLink}" 
                             style="display: inline-block; background: linear-gradient(135deg, #ec4899 0%, #f472b6 100%); color: white; padding: 18px 48px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 18px; box-shadow: 0 6px 20px rgba(236, 72, 153, 0.4); transition: transform 0.2s;">
                            Open Your Letter 💌
                          </a>
                        </div>

                        <!-- Alternative Link - More Visible -->
                        <div style="margin: 32px 0 0; padding: 20px; background: linear-gradient(135deg, #fef3f2 0%, #fce7f3 100%); border-radius: 8px; border: 2px solid #ec4899;">
                          <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0 0 12px; text-align: center; font-weight: 600;">
                            Or copy and paste this link:
                          </p>
                          <p style="color: #ec4899; font-size: 14px; word-break: break-all; background: white; padding: 16px; border-radius: 8px; margin: 0; text-align: center; border: 1px solid #fce7f3; font-family: 'Courier New', monospace; line-height: 1.6;">
                            <a href="${shareableLink}" style="color: #ec4899; text-decoration: underline;">${shareableLink}</a>
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>

                  <!-- Footer - Better Contrast -->
                  <tr>
                    <td align="center" style="padding: 30px; background: rgba(255, 255, 255, 0.9); border-top: 1px solid rgba(236, 72, 153, 0.2);">
                      <p style="color: #4b5563; font-size: 14px; margin: 0; line-height: 1.8; font-weight: 500;">
                        Made with <span style="color: #ec4899; font-size: 16px;">❤️</span> by <strong style="color: #ec4899;">${sender}</strong> for <strong style="color: #ec4899;">${receiverName}</strong>
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

    // If scheduled, store the email in Firebase for later sending
    if (scheduledDateTime) {
      if (!db) {
        return res.status(500).json({
          success: false,
          error: "Database not available. Cannot schedule email.",
        });
      }

      try {
        // Generate a unique ID for the scheduled email
        const scheduledEmailId = `scheduled_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Store scheduled email in Firebase
        const scheduledEmailsRef = db.ref('scheduledEmails');
        await scheduledEmailsRef.child(scheduledEmailId).set({
          recipientEmail,
          recipientName: receiverName,
          senderName: sender,
          shareableLink,
          letterTitle: title,
          scheduledDateTime,
          status: 'pending',
          createdAt: new Date().toISOString(),
          mailOptions: mailOptions, // Store the full mail options for sending later
        });

        console.log(`📅 Letter email scheduled for: ${recipientEmail} at ${scheduledDateTime} (ID: ${scheduledEmailId})`);
        
        res.status(200).json({
          success: true,
          message: "Letter email scheduled successfully",
          scheduledDateTime: scheduledDateTime,
          scheduledEmailId: scheduledEmailId,
        });
      } catch (dbError) {
        console.error("❌ Error storing scheduled email:", dbError);
        res.status(500).json({
          success: false,
          error: "Failed to schedule email",
          details: dbError.message,
        });
      }
    } else {
      // Send email immediately
      console.log(`📧 Sending letter email to: ${recipientEmail}`);
      
      await transporter.sendMail(mailOptions);

      console.log(`✅ Letter email sent successfully to: ${recipientEmail}`);

      res.status(200).json({
        success: true,
        message: "Letter email sent successfully",
      });
    }
  } catch (error) {
    console.error("❌ Error sending letter email:", error);
    res.status(500).json({
      success: false,
      error: "Failed to send letter email",
      details: error.message,
    });
  }
});

module.exports = router;

