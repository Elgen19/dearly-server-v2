// Input validation and sanitization middleware
const crypto = require('crypto');

/**
 * Sanitize string input - remove potentially dangerous characters
 */
const sanitizeString = (str, maxLength = 10000) => {
  if (typeof str !== 'string') return str;
  // Trim and limit length
  let sanitized = str.trim().substring(0, maxLength);
  // Remove null bytes and control characters (except newlines and tabs for letter content)
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
  return sanitized;
};

/**
 * Validate email format
 */
const isValidEmail = (email) => {
  if (typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim().toLowerCase());
};

/**
 * Validate token format (64 hex characters)
 */
const isValidToken = (token) => {
  if (typeof token !== 'string') return false;
  return /^[a-f0-9]{64}$/i.test(token);
};

/**
 * Validate userId format (Firebase UID format)
 */
const isValidUserId = (userId) => {
  if (typeof userId !== 'string') return false;
  // Firebase UIDs are typically 28 characters, alphanumeric
  // But can vary, so we check for reasonable length and safe characters
  return /^[a-zA-Z0-9_-]{15,128}$/.test(userId);
};

/**
 * Validate letterId format
 */
const isValidLetterId = (letterId) => {
  if (typeof letterId !== 'string') return false;
  // Letter IDs should be alphanumeric with dashes/underscores, reasonable length
  return /^[a-zA-Z0-9_-]{1,128}$/.test(letterId);
};

/**
 * Sanitize and validate request body
 */
const sanitizeBody = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    // Sanitize string fields
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        // Allow longer content for letter body, but still limit
        const maxLength = ['introductory', 'mainBody', 'closing', 'content'].includes(key) ? 50000 : 1000;
        req.body[key] = sanitizeString(req.body[key], maxLength);
      }
    }
  }
  next();
};

/**
 * Validate token parameter
 */
const validateTokenParam = (req, res, next) => {
  const { token } = req.params;
  if (!token) {
    return res.status(400).json({
      success: false,
      message: "A token is required to access this letter. Please check your link. 💌"
    });
  }
  if (!isValidToken(token)) {
    return res.status(400).json({
      success: false,
      message: "The link format appears to be invalid. Please check with the sender for a new link. 💔"
    });
  }
  next();
};

/**
 * Validate userId parameter
 */
const validateUserIdParam = (req, res, next) => {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "User ID is required"
    });
  }
  if (!isValidUserId(userId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid user ID format"
    });
  }
  next();
};

/**
 * Validate letterId parameter
 */
const validateLetterIdParam = (req, res, next) => {
  const { letterId } = req.params;
  if (!letterId) {
    return res.status(400).json({
      success: false,
      message: "Letter ID is required"
    });
  }
  if (!isValidLetterId(letterId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid letter ID format"
    });
  }
  next();
};

/**
 * Anonymize IP address (keep first 2 octets, mask the rest)
 */
const anonymizeIP = (ip) => {
  if (!ip) return 'unknown';
  // Handle IPv4
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.xxx.xxx`;
    }
  }
  // Handle IPv6 - keep first 4 groups, mask the rest
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length > 4) {
      return `${parts.slice(0, 4).join(':')}:xxxx:xxxx`;
    }
  }
  // If we can't parse it, return masked version
  return 'xxx.xxx.xxx.xxx';
};

module.exports = {
  sanitizeString,
  isValidEmail,
  isValidToken,
  isValidUserId,
  isValidLetterId,
  sanitizeBody,
  validateTokenParam,
  validateUserIdParam,
  validateLetterIdParam,
  anonymizeIP
};

