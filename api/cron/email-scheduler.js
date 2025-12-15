// Vercel Cron Job endpoint for email scheduler
// This runs every minute to check for scheduled emails
const nodemailer = require('nodemailer');
const { db } = require('../../configs/firebase');
require('dotenv').config();

// Create email transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Send a scheduled email
 */
async function sendScheduledEmail(emailData, emailId) {
  try {
    const scheduledDateTime = new Date(emailData.scheduledDateTime);
    const now = new Date();
    
    if (scheduledDateTime > now) {
      return false;
    }

    // Update status to 'sending'
    if (db) {
      const emailRef = db.ref(`scheduledEmails/${emailId}`);
      await emailRef.update({ status: 'sending', sendingStartedAt: new Date().toISOString() });
    }

    // Send the email
    await transporter.sendMail(emailData.mailOptions);

    // Delete the email from scheduledEmails node after successful send
    if (db) {
      const emailRef = db.ref(`scheduledEmails/${emailId}`);
      await emailRef.remove();
    }

    return true;
  } catch (error) {
    console.error(`Error sending scheduled email (ID: ${emailId}):`, error);
    
    // Update status to 'failed'
    if (db) {
      const emailRef = db.ref(`scheduledEmails/${emailId}`);
      await emailRef.update({ 
        status: 'failed', 
        error: error.message,
        failedAt: new Date().toISOString()
      });
    }
    
    return false;
  }
}

/**
 * Vercel Cron Job handler
 */
module.exports = async (req, res) => {
  // Vercel Cron Jobs automatically add a 'x-vercel-cron' header
  // Optionally verify CRON_SECRET if set
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  
  // Additional check for Vercel cron header (recommended)
  const cronHeader = req.headers['x-vercel-cron'];
  if (!cronHeader && process.env.NODE_ENV === 'production') {
    // In production, only allow Vercel cron requests
    // For manual testing, you can bypass this check
    return res.status(403).json({ error: 'Forbidden: Not a cron request' });
  }

  try {
    if (!db) {
      console.warn('⚠️ Database not available. Skipping scheduled email check.');
      return res.status(503).json({ 
        success: false, 
        message: 'Database not available' 
      });
    }

    const now = new Date();
    const scheduledEmailsRef = db.ref('scheduledEmails');
    const snapshot = await scheduledEmailsRef.once('value');
    const scheduledEmails = snapshot.val();

    if (!scheduledEmails) {
      return res.status(200).json({ 
        success: true, 
        message: 'No scheduled emails found',
        checked: now.toISOString()
      });
    }

    const emailsToSend = [];
    const emailIds = Object.keys(scheduledEmails);

    for (const emailId of emailIds) {
      const email = scheduledEmails[emailId];
      
      if (email.status !== 'pending') {
        continue;
      }

      if (!email.scheduledDateTime) {
        continue;
      }

      const scheduledDate = new Date(email.scheduledDateTime);
      const timeDiff = scheduledDate - now;

      // Send if scheduled time has passed (within 1 minute tolerance)
      if (timeDiff <= 60000 && timeDiff >= -60000) {
        emailsToSend.push({ emailId, emailData: email });
      }
    }

    // Send all ready emails
    const results = await Promise.allSettled(
      emailsToSend.map(({ emailId, emailData }) => 
        sendScheduledEmail(emailData, emailId)
      )
    );

    const successful = results.filter(r => r.status === 'fulfilled' && r.value).length;
    const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)).length;

    return res.status(200).json({
      success: true,
      message: `Processed ${emailsToSend.length} scheduled email(s)`,
      successful,
      failed,
      checked: now.toISOString()
    });
  } catch (error) {
    console.error('❌ Error checking scheduled emails:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check scheduled emails',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
