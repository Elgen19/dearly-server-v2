 /**
 * Vercel Email Service
 * Sends emails via Vercel serverless function (which allows Gmail SMTP)
 */

/**
 * Send email via Vercel serverless function
 * @param {object} mailOptions - { from, to, subject, html, text } OR letter email format
 */
async function sendMailViaVercel(mailOptions) {
  const vercelEmailUrl = process.env.VERCEL_EMAIL_URL;
  
  if (!vercelEmailUrl) {
    throw new Error('VERCEL_EMAIL_URL environment variable is required when using Vercel email service');
  }

  // Ensure URL doesn't have trailing slash
  const baseUrl = vercelEmailUrl.replace(/\/$/, '');
  const emailEndpoint = `${baseUrl}/api/send-email`;

  try {
    const response = await fetch(emailEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mailOptions),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Vercel email service error: ${response.status} ${response.statusText} - ${errorData.error || errorData.message || ''}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    // If it's already our formatted error, throw as-is
    if (error.message && error.message.includes('Vercel email service error')) {
      throw error;
    }
    
    // Otherwise, wrap it
    throw new Error(`Failed to call Vercel email service: ${error.message}`);
  }
}

module.exports = { sendMailViaVercel };

