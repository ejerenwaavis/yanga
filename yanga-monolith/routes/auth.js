import express from 'express';
import jwt from 'jsonwebtoken';

const router = express.Router();
const ROKIT_API_URL = process.env.ROKIT_API_URL || 'https://rokitonline.com/api';
const JWT_SECRET = process.env.ROKIT_JWT_SECRET || process.env.JWT_SECRET || 'rokit-super-duper-secret-key';

/**
 * Helper to set the wildcard parent-domain SSO cookie
 */
const setSSOCookie = (res, req, token) => {
  const isRokitDomain = req.hostname && req.hostname.includes('rokitonline.com');
  const cookieOptions = {
    httpOnly: false, // Accessible to client if needed
    secure: process.env.NODE_ENV === 'production' || req.secure || isRokitDomain,
    sameSite: 'lax',
    maxAge: 15 * 24 * 60 * 60 * 1000 // 15 days
  };

  if (isRokitDomain) {
    cookieOptions.domain = '.rokitonline.com';
  }

  res.cookie('rokit_sso_token', token, cookieOptions);
};

/**
 * GET /api/auth/me
 * Checks if incoming request has a valid SSO token (via cookie or Authorization header)
 */
router.get('/me', async (req, res) => {
  try {
    const token = 
      req.cookies?.rokit_sso_token || 
      req.headers['authorization']?.split(' ')[1] ||
      req.headers['x-rokit-token'];

    if (!token) {
      return res.status(401).json({ success: false, authenticated: false });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.mfaPending) {
      return res.status(401).json({ success: false, authenticated: false, mfaPending: true });
    }

    const userId = decoded.id || decoded.userId || decoded._id;
    return res.json({
      success: true,
      authenticated: true,
      user: {
        _id: userId,
        email: decoded.email || null,
        role: decoded.role || 'customer'
      }
    });
  } catch (err) {
    return res.status(401).json({ success: false, authenticated: false, error: err.message });
  }
});

/**
 * POST /api/auth/login
 * Validates credentials against central Rokit Online user base
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const response = await fetch(`${ROKIT_API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ success: false, message: data.message || 'Login failed' });
    }

    // If Rokit Online requires MFA, relay the mfaToken to client
    if (data.mfaPending) {
      return res.json({ success: true, mfaPending: true, mfaToken: data.mfaToken });
    }

    // If login returned a full session token
    if (data.token) {
      setSSOCookie(res, req, data.token);
      return res.json({
        success: true,
        user: {
          _id: data._id,
          name: data.name,
          email: data.email,
          role: data.role
        },
        token: data.token
      });
    }

    res.status(500).json({ success: false, message: 'Invalid response from auth provider' });
  } catch (err) {
    console.error('SSO Login Proxy Error:', err);
    res.status(500).json({ success: false, message: 'Could not connect to Rokit authentication service' });
  }
});

/**
 * POST /api/auth/verify-mfa
 * Verifies 6-digit MFA code with Rokit Online
 */
router.post('/verify-mfa', async (req, res) => {
  try {
    const { mfaToken, code } = req.body;
    if (!mfaToken || !code) {
      return res.status(400).json({ success: false, message: 'Token and code are required' });
    }

    const response = await fetch(`${ROKIT_API_URL}/auth/verify-mfa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken, code })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ success: false, message: data.message || 'Verification failed' });
    }

    if (data.token) {
      setSSOCookie(res, req, data.token);
      return res.json({
        success: true,
        user: {
          _id: data._id,
          name: data.name,
          email: data.email,
          role: data.role
        },
        token: data.token
      });
    }

    res.status(500).json({ success: false, message: 'Invalid response from verification service' });
  } catch (err) {
    console.error('SSO MFA Verify Proxy Error:', err);
    res.status(500).json({ success: false, message: 'Verification service error' });
  }
});

/**
 * POST /api/auth/logout
 * Clears the wildcard SSO cookie
 */
router.post('/logout', (req, res) => {
  const isRokitDomain = req.hostname && req.hostname.includes('rokitonline.com');
  const cookieOptions = {};
  if (isRokitDomain) {
    cookieOptions.domain = '.rokitonline.com';
  }
  res.clearCookie('rokit_sso_token', cookieOptions);
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
