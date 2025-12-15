const nodemailer = require("nodemailer");

// Create transporter configuration with support for Gmail or Resend
function createMailerTransporter() {
  const emailService = (process.env.EMAIL_SERVICE || 'gmail').toLowerCase();

  // Resend SMTP configuration
  if (emailService === 'resend') {
    return nodemailer.createTransport({
      host: "smtp.resend.com",
      port: process.env.EMAIL_SMTP_PORT ? parseInt(process.env.EMAIL_SMTP_PORT) : 465,
      secure: true, // Resend recommends 465 SSL
      auth: {
        user: "resend",
        pass: process.env.RESEND_API_KEY,
      },
      connectionTimeout: 20000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      pool: false,
      tls: {
        rejectUnauthorized: false,
      },
      debug: process.env.NODE_ENV === 'development',
      logger: process.env.NODE_ENV === 'development',
    });
  }

  // Gmail default configuration
  const useSecure = process.env.EMAIL_USE_SECURE === 'true' || false;
  const smtpPort = process.env.EMAIL_SMTP_PORT ? parseInt(process.env.EMAIL_SMTP_PORT) : (useSecure ? 465 : 587);
  
  const config = {
    host: "smtp.gmail.com",
    port: smtpPort,
    secure: useSecure, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    connectionTimeout: 20000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    pool: false,
    retry: {
      max: 3,
      minTimeout: 3000,
      maxTimeout: 8000,
    },
    tls: {
      rejectUnauthorized: false,
    },
    debug: process.env.NODE_ENV === 'development',
    logger: process.env.NODE_ENV === 'development',
  };
  
  if (!process.env.EMAIL_SMTP_PORT) {
    config.service = "gmail";
  }
  
  return nodemailer.createTransport(config);
}

// Default transporter instance (for SMTP providers)
const transporter = createMailerTransporter();

/**
 * sendMail - unified mail sending helper (supports Resend API or SMTP)
 * @param {object} mailOptions - { from, to, subject, html, text }
 */
async function sendMail(mailOptions) {
  const emailService = (process.env.EMAIL_SERVICE || 'gmail').toLowerCase();

  if (emailService === 'resend') {
    // Send via Resend HTTP API
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is required when EMAIL_SERVICE=resend');
    }

    const payload = {
      from: mailOptions.from,
      to: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to],
      subject: mailOptions.subject,
      html: mailOptions.html,
      text: mailOptions.text,
    };

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Resend API error: ${response.status} ${response.statusText} - ${errBody}`);
    }

    return response.json();
  }

  // Fallback to SMTP transporter (Gmail or custom SMTP)
  return transporter.sendMail(mailOptions);
}

/**
 * sendEmail - simple helper for generic messaging
 * @param {string} to
 * @param {string} message
 */
const sendEmail = async (to, message = "") => {
  const defaultMessage = "There's something special waiting for you 💖";
  const finalMessage = message.trim() || defaultMessage;
  const CLIENT_URL = process.env.CLIENT_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');
  const FROM_EMAIL = process.env.EMAIL_USER || 'noreply@dearly.app';
  const FROM_NAME = process.env.EMAIL_FROM_NAME || 'Dearly 💌';

  const mailOptions = {
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to,
    subject: "A special letter for you 💌",
    html: `
      <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px; background-color:#fff0f6; border-radius:12px;">
        <h2 style="color: #d63384;">Hi there 💖</h2>
        <p style="font-size: 16px;">${finalMessage}</p>
        <a href="${CLIENT_URL}" 
           style="display: inline-block; background-color: #ff69b4; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
           Open Your Letter 💌
        </a>
        <p style="margin-top: 20px; font-size: 14px; color: #555;">
          With love,<br/>Dearly
        </p>
      </div>
    `,
  };

  return sendMail(mailOptions);
};

module.exports = { sendEmail, createMailerTransporter, sendMail };