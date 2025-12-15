// emailScheduler.js - Cron job to check and send scheduled emails
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const { db } = require('../configs/firebase');
require('dotenv').config();

// Create email transporter (reusable)
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
    // Double-check that the scheduled time has actually passed
    const scheduledDateTime = new Date(emailData.scheduledDateTime);
    const now = new Date();
    
    if (scheduledDateTime > now) {
      console.log(`⏳ Email ${emailId} is not ready yet. Scheduled: ${emailData.scheduledDateTime}, Now: ${now.toISOString()}`);
      return false;
    }

    console.log(`📧 Sending scheduled email to: ${emailData.recipientEmail} (ID: ${emailId})`);
    console.log(`   Scheduled for: ${emailData.scheduledDateTime}, Current time: ${now.toISOString()}`);
    
    // Update status to 'sending'
    if (db) {
      const emailRef = db.ref(`scheduledEmails/${emailId}`);
      await emailRef.update({ status: 'sending', sendingStartedAt: new Date().toISOString() });
    }

    // Send the email using stored mailOptions
    await transporter.sendMail(emailData.mailOptions);

    console.log(`✅ Scheduled email sent successfully to: ${emailData.recipientEmail} (ID: ${emailId})`);

    // Delete the email from scheduledEmails node after successful send
    if (db) {
      const emailRef = db.ref(`scheduledEmails/${emailId}`);
      await emailRef.remove();
      console.log(`🗑️ Deleted scheduled email ${emailId} from database after successful send`);
    }

    return true;
  } catch (error) {
    console.error(`❌ Error sending scheduled email (ID: ${emailId}):`, error);
    
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
 * Check for scheduled emails that are ready to be sent
 * @param {boolean} isStartupCheck - If true, only process emails that are significantly overdue (1+ minute)
 */
async function checkAndSendScheduledEmails(isStartupCheck = false) {
  if (!db) {
    console.warn('⚠️ Database not available. Skipping scheduled email check.');
    return;
  }

  try {
    const now = new Date();
    const scheduledEmailsRef = db.ref('scheduledEmails');
    const snapshot = await scheduledEmailsRef.once('value');
    const scheduledEmails = snapshot.val();

    if (!scheduledEmails) {
      return; // No scheduled emails
    }

    const emailsToSend = [];
    // For startup checks, require at least 1 minute buffer to avoid sending emails scheduled for the very near future
    const minBuffer = isStartupCheck ? 60000 : 10000; // 1 minute for startup, 10 seconds for regular checks
    
    // Find emails that are ready to be sent
    Object.keys(scheduledEmails).forEach((emailId) => {
      const email = scheduledEmails[emailId];
      
      // Only process pending emails
      if (email.status !== 'pending') {
        return;
      }

      const scheduledDateTime = new Date(email.scheduledDateTime);
      
      // Validate the date
      if (isNaN(scheduledDateTime.getTime())) {
        console.warn(`⚠️ Invalid scheduled date for email ${emailId}: ${email.scheduledDateTime}`);
        return;
      }
      
      // Check if it's time to send (must be in the past, with a buffer for cron timing)
      const timeDiff = now.getTime() - scheduledDateTime.getTime();
      
      if (timeDiff >= minBuffer) {
        console.log(`✅ Email ${emailId} is ready to send. Scheduled: ${email.scheduledDateTime}, Now: ${now.toISOString()}, Diff: ${Math.round(timeDiff/1000)}s`);
        emailsToSend.push({ emailId, email });
      } else if (timeDiff >= 0) {
        // Scheduled time is very close - will be picked up on next cron run
        console.log(`⏳ Email ${emailId} scheduled for ${email.scheduledDateTime} is very close (${Math.round(timeDiff/1000)}s), will send on next check`);
      } else {
        // Scheduled time is in the future
        const futureDiff = Math.abs(timeDiff);
        const minutesUntil = Math.floor(futureDiff / 60000);
        console.log(`⏰ Email ${emailId} scheduled for ${email.scheduledDateTime} is ${minutesUntil} minute(s) in the future`);
      }
    });

    if (emailsToSend.length === 0) {
      return; // No emails ready to send
    }

    console.log(`📬 Found ${emailsToSend.length} scheduled email(s) ready to send`);

    // Send all ready emails
    for (const { emailId, email } of emailsToSend) {
      await sendScheduledEmail(email, emailId);
      // Small delay between emails to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

  } catch (error) {
    console.error('❌ Error checking scheduled emails:', error);
  }
}

/**
 * Initialize the email scheduler cron job
 * Runs every minute to check for scheduled emails
 */
function initializeEmailScheduler() {
  if (!db) {
    console.warn('⚠️ Database not available. Email scheduler will not start.');
    return null;
  }

  console.log('⏰ Initializing email scheduler (runs every minute)...');

  // Run every minute at the start of each minute: '0 * * * * *' (second, minute, hour, day, month, weekday)
  // This runs at :00 seconds of every minute
  const cronJob = cron.schedule('0 * * * * *', async () => {
    console.log('⏰ Cron job running - checking for scheduled emails...');
    await checkAndSendScheduledEmails();
  }, {
    scheduled: true,
    timezone: "UTC"
  });

  // Also run immediately on startup to catch any missed emails (only those that are significantly overdue)
  // This helps if the server was down when emails were supposed to be sent
  setTimeout(() => {
    console.log('🔍 Checking for overdue scheduled emails on startup (emails scheduled more than 1 minute ago)...');
    // Only check for emails that are at least 1 minute overdue to avoid sending emails scheduled for the very near future
    checkAndSendScheduledEmails(true); // Pass true to indicate startup check
  }, 5000); // Wait 5 seconds after server starts

  console.log('✅ Email scheduler initialized successfully');
  
  return cronJob;
}

module.exports = {
  initializeEmailScheduler,
  checkAndSendScheduledEmails,
  sendScheduledEmail
};

