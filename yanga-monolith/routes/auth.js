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

// In-memory profile cache for central Rokit SSO users
const userProfileCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Fetch user profile from central Rokit Online backend
 */
async function fetchRokitProfile(token, userId) {
  if (userProfileCache.has(userId)) {
    const cached = userProfileCache.get(userId);
    if (Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.profile;
    }
  }

  try {
    const res = await fetch(`${ROKIT_API_URL}/auth/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Cookie': `rokit_sso_token=${token}`
      }
    });

    if (res.ok) {
      const data = await res.json();
      if (data && (data.name || data.email)) {
        userProfileCache.set(userId, { profile: data, cachedAt: Date.now() });
        return data;
      }
    } else {
      console.warn(`[ROKIT SSO] /auth/me returned status ${res.status}`);
    }
  } catch (err) {
    console.warn('[ROKIT SSO] Could not reach Rokit /auth/me:', err.message);
  }

  // Graceful fallback to any existing stale cache
  return userProfileCache.get(userId)?.profile || null;
}

/**
 * GET /api/auth/me
 * Checks if incoming request has a valid SSO token (via cookie or Authorization header)
 * and retrieves user's full name & email from central Rokit profile
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
    const profile = await fetchRokitProfile(token, userId);

    const fullName = profile?.name || decoded.name || null;
    const userEmail = profile?.email || decoded.email || null;

    return res.json({
      success: true,
      authenticated: true,
      user: {
        _id: userId,
        name: fullName,
        fullName: fullName,
        email: userEmail,
        role: profile?.role || decoded.role || 'customer'
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
      if (data._id) {
        userProfileCache.set(data._id, {
          profile: { _id: data._id, name: data.name, email: data.email, role: data.role },
          cachedAt: Date.now()
        });
      }
      return res.json({
        success: true,
        user: {
          _id: data._id,
          name: data.name,
          fullName: data.name,
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
      if (data._id) {
        userProfileCache.set(data._id, {
          profile: { _id: data._id, name: data.name, email: data.email, role: data.role },
          cachedAt: Date.now()
        });
      }
      return res.json({
        success: true,
        user: {
          _id: data._id,
          name: data.name,
          fullName: data.name,
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
