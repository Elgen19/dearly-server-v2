const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const { sendMailViaVercel } = require("./vercel-email");

// Create transporter configuration with support for Gmail or Resend (SMTP fallback)
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

  // Outlook/Hotmail SMTP configuration
  if (emailService === 'outlook' || emailService === 'hotmail') {
    return nodemailer.createTransport({
      host: "smtp-mail.outlook.com",
      port: 587,
      secure: false, // Outlook uses STARTTLS on port 587
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
        ciphers: 'SSLv3',
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
 * sendMailViaGmailAPI - Send email using Gmail API (REST, not SMTP)
 * @param {object} mailOptions - { from, to, subject, html, text }
 */
async function sendMailViaGmailAPI(mailOptions) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const userEmail = process.env.EMAIL_USER || process.env.GMAIL_USER;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail API requires GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN environment variables');
  }

  if (!userEmail) {
    throw new Error('Gmail API requires EMAIL_USER or GMAIL_USER environment variable');
  }

  // Parse "from" address
  const parseAddress = (address) => {
    if (!address) return { email: '', name: '' };
    const match = address.match(/^(.*)<(.+)>$/);
    if (match) {
      return {
        name: match[1].trim().replace(/^"|"$/g, ''),
        email: match[2].trim(),
      };
    }
    return { email: address.trim(), name: '' };
  };

  const normalizeToArray = (to) => {
    if (!to) return [];
    if (Array.isArray(to)) return to;
    return [to];
  };

  // Set up OAuth2 client
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'urn:ietf:wg:oauth:2.0:oob' // Redirect URI (not used for refresh token flow)
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  // Get access token
  const accessToken = await oauth2Client.getAccessToken();

  // Prepare email message
  const sender = parseAddress(mailOptions.from);
  const toList = normalizeToArray(mailOptions.to);
  const fromEmail = sender.email || userEmail;
  const fromName = sender.name || process.env.EMAIL_FROM_NAME || 'Dearly 💌';

  // Encode subject for UTF-8 (handles special characters)
  const encodeSubject = (subject) => {
    if (!subject) return '';
    // If subject contains non-ASCII, encode it
    if (/[^\x00-\x7F]/.test(subject)) {
      return `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
    }
    return subject;
  };

  // Build email message in RFC 2822 format
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  let messageParts = [
    `From: "${fromName}" <${fromEmail}>`,
    `To: ${toList.join(', ')}`,
    `Subject: ${encodeSubject(mailOptions.subject || '')}`,
    `MIME-Version: 1.0`,
  ];

  // Add content type based on what we have
  if (mailOptions.html && mailOptions.text) {
    // Multipart alternative (HTML + plain text)
    messageParts.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    messageParts.push('');
    messageParts.push(`--${boundary}`);
    messageParts.push(`Content-Type: text/plain; charset=utf-8`);
    messageParts.push(`Content-Transfer-Encoding: quoted-printable`);
    messageParts.push('');
    messageParts.push(mailOptions.text);
    messageParts.push(`--${boundary}`);
    messageParts.push(`Content-Type: text/html; charset=utf-8`);
    messageParts.push(`Content-Transfer-Encoding: quoted-printable`);
    messageParts.push('');
    messageParts.push(mailOptions.html);
    messageParts.push(`--${boundary}--`);
  } else if (mailOptions.html) {
    // HTML only
    messageParts.push(`Content-Type: text/html; charset=utf-8`);
    messageParts.push('');
    messageParts.push(mailOptions.html);
  } else {
    // Plain text only
    messageParts.push(`Content-Type: text/plain; charset=utf-8`);
    messageParts.push('');
    messageParts.push(mailOptions.text || '');
  }

  const message = messageParts.join('\r\n');

  // Encode message in base64url format
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // Send email via Gmail API
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  try {
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    return {
      messageId: response.data.id,
      success: true,
    };
  } catch (error) {
    console.error('Gmail API error:', error);
    throw new Error(`Gmail API error: ${error.message}`);
  }
}

/**
 * sendMail - unified mail sending helper (supports Gmail API, Resend/Brevo HTTP API, or SMTP)
 * @param {object} mailOptions - { from, to, subject, html, text }
 */
async function sendMail(mailOptions) {
  const emailService = (process.env.EMAIL_SERVICE || 'gmail').toLowerCase();

  // Vercel serverless function (Gmail SMTP, works on Vercel)
  if (emailService === 'vercel' || emailService === 'vercel-gmail') {
    return sendMailViaVercel(mailOptions);
  }

  // Gmail API (REST API, not SMTP)
  if (emailService === 'gmail-api') {
    return sendMailViaGmailAPI(mailOptions);
  }

  // Helper to normalize "from" and "to"
  const parseAddress = (address) => {
    if (!address) return { email: '', name: '' };
    // Handle "Name <email@domain>" format
    const match = address.match(/^(.*)<(.+)>$/);
    if (match) {
      return {
        name: match[1].trim().replace(/^"|"$/g, ''),
        email: match[2].trim(),
      };
    }
    return { email: address.trim(), name: '' };
  };

  const normalizeToArray = (to) => {
    if (!to) return [];
    if (Array.isArray(to)) return to;
    return [to];
  };

  // Brevo HTTP API
  if (emailService === 'brevo') {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      throw new Error('BREVO_API_KEY is required when EMAIL_SERVICE=brevo');
    }

    const sender = parseAddress(mailOptions.from);
    const toList = normalizeToArray(mailOptions.to).map(parseAddress).filter(a => a.email);

    const payload = {
      sender: {
        email: sender.email,
        name: sender.name || process.env.EMAIL_FROM_NAME || 'Dearly 💌',
      },
      to: toList.map(t => ({
        email: t.email,
        name: t.name || undefined,
      })),
      subject: mailOptions.subject,
      htmlContent: mailOptions.html,
      textContent: mailOptions.text,
    };

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Brevo API error: ${response.status} ${response.statusText} - ${errBody}`);
    }

    return response.json();
  }

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
  } // end resend

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