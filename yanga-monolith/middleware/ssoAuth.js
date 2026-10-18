import jwt from 'jsonwebtoken';

/**
 * requireRokitSSO
 * Middleware that validates the Wildcard SSO JWT (.rokitonline.com).
 * Looks for rokit_sso_token in cookies, Authorization Bearer header, or x-rokit-token.
 * Verifies with ROKIT_JWT_SECRET and attaches req.user (including MongoDB _id).
 */
export const requireRokitSSO = (req, res, next) => {
  try {
    // 1. Check for shared SSO cookie from *.rokitonline.com, Authorization header, or x-rokit-token
    const token = 
      req.cookies?.rokit_sso_token || 
      req.headers['authorization']?.split(' ')[1] ||
      req.headers['x-rokit-token'];

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication required. Please log in via Rokit Media to access Yanga Studio.' 
      });
    }

    // 2. Verify token with shared secret (must match rokitonline.com backend secret)
    const secret = process.env.ROKIT_JWT_SECRET || process.env.JWT_SECRET || 'rokit-super-duper-secret-key';
    const decoded = jwt.verify(token, secret);

    if (decoded.mfaPending) {
      return res.status(401).json({ success: false, error: 'MFA verification required. Please complete verification.' });
    }

    // 3. Attach user payload with MongoDB _id
    req.user = {
      userId: decoded.id || decoded.userId || decoded._id,
      email: decoded.email,
      role: decoded.role || 'customer'
    };

    if (!req.user.userId) {
      return res.status(401).json({ success: false, error: 'Malformed token payload.' });
    }

    next();
  } catch (error) {
    console.error('SSO Authentication Error:', error.message);
    return res.status(401).json({ success: false, error: 'Invalid or expired session token. Please log in again.' });
  }
};
