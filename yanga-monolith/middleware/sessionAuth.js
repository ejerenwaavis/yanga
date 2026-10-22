import { validateSession } from '../services/identityService.js';

export const COOKIE_NAME = 'yanga_session';

/**
 * Authenticate session from cookie or Authorization header
 * Attaches req.user and req.session if valid
 */
export async function authenticateSession(req, res, next) {
  try {
    const rawToken = 
      req.cookies?.[COOKIE_NAME] ||
      req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
      req.headers['x-session-token'];

    if (!rawToken) {
      req.user = null;
      req.session = null;
      return next();
    }

    const result = await validateSession(rawToken);
    if (!result) {
      req.user = null;
      req.session = null;
      return next();
    }

    req.user = result.user;
    req.session = result.session;
    next();
  } catch (err) {
    req.user = null;
    req.session = null;
    next();
  }
}

/**
 * Require an authenticated user and enforce user status
 */
export function requireAuth(req, res, next) {
  if (!req.user || !req.session) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      error: 'Authentication required. Please sign in to continue.'
    });
  }

  // Requirement 5: Status enforcement
  if (req.user.status === 'banned') {
    return res.status(403).json({
      success: false,
      banned: true,
      error: 'Your account has been permanently suspended for violations of our terms.'
    });
  }

  if (req.user.status === 'suspended') {
    return res.status(403).json({
      success: false,
      suspended: true,
      error: 'Your account is currently suspended. Please contact support to appeal.'
    });
  }

  next();
}

/**
 * Gate generation and purchases: restricted users cannot generate or buy
 */
export function requireActiveGeneration(req, res, next) {
  if (req.user && req.user.status === 'restricted') {
    return res.status(403).json({
      success: false,
      restricted: true,
      error: 'Your account is restricted from generating photos or making purchases. Please contact support.'
    });
  }
  next();
}

/**
 * CSRF Protection Middleware for state-changing routes (POST, PUT, PATCH, DELETE)
 * Validates X-CSRF-Token header against session.csrfToken
 */
export function requireCsrf(req, res, next) {
  // Safe HTTP methods do not require CSRF
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip CSRF on OAuth callbacks and webhooks
  if (
    req.path.includes('/api/auth/callback/') || 
    req.path.includes('/api/stripe/webhook') ||
    req.path.includes('/api/auth/login') // initial login handshake
  ) {
    return next();
  }

  // If request is authenticated with session cookie, verify CSRF token
  if (req.cookies?.[COOKIE_NAME] && req.session) {
    const clientToken = req.headers['x-csrf-token'] || req.body?._csrf;
    if (!clientToken || clientToken !== req.session.csrfToken) {
      return res.status(403).json({
        success: false,
        error: 'Invalid or missing CSRF token. Please refresh the page and try again.'
      });
    }
  }

  next();
}
