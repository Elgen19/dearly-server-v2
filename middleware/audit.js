// Audit logging middleware for security events
const { db } = require('../configs/firebase');
const { anonymizeIP } = require('./validation');

/**
 * Log security events to Firebase for audit trail
 */
const logSecurityEvent = async (eventType, details) => {
  if (!db) {
    console.warn('⚠️ Firebase not initialized, skipping audit log');
    return;
  }

  try {
    const auditRef = db.ref('securityAudit').push();
    await auditRef.set({
      eventType,
      timestamp: new Date().toISOString(),
      ...details,
      // Anonymize IP if present
      ip: details.ip ? anonymizeIP(details.ip) : undefined,
    });
  } catch (error) {
    console.error('❌ Error logging security event:', error);
    // Don't throw - audit logging failure shouldn't break the request
  }
};

/**
 * Middleware to log authentication events
 */
const logAuthEvent = async (req, eventType, details = {}) => {
  await logSecurityEvent(eventType, {
    ...details,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('user-agent'),
    path: req.path,
  });
};

/**
 * Middleware to log token access events
 */
const logTokenAccess = async (req, token, success, reason = null) => {
  await logSecurityEvent('token_access', {
    token: token ? token.substring(0, 8) + '...' : null,
    success,
    reason,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('user-agent'),
  });
};

/**
 * Middleware to log security validation attempts
 */
const logSecurityValidation = async (req, letterId, success, reason = null) => {
  await logSecurityEvent('security_validation', {
    letterId,
    success,
    reason,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('user-agent'),
  });
};

/**
 * Middleware to log rate limit violations
 */
const logRateLimitViolation = async (req, endpoint) => {
  await logSecurityEvent('rate_limit_violation', {
    endpoint,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('user-agent'),
  });
};

module.exports = {
  logSecurityEvent,
  logAuthEvent,
  logTokenAccess,
  logSecurityValidation,
  logRateLimitViolation,
};

