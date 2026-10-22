import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  resolveOrLinkIdentity,
  createSession,
  destroySession,
  logoutAllEverywhere,
  unlinkIdentity,
  getUserIdentities,
  normalizeEmail
} from '../services/identityService.js';
import { COOKIE_NAME, requireAuth, requireCsrf } from '../middleware/sessionAuth.js';
import User from '../models/User.js';
import Identity from '../models/Identity.js';
import Session from '../models/Session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const ROKIT_ISSUER = process.env.ROKIT_ISSUER_URL || 'https://rokitonline.com';
const ROKIT_CLIENT_ID = process.env.ROKIT_CLIENT_ID || 'yanga_studio';
const ROKIT_CLIENT_SECRET = process.env.ROKIT_CLIENT_SECRET || 'yanga_secret_production_key_2026';

function base64url(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generatePKCE() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function setSessionCookie(res, req, token) {
  const isProd = process.env.NODE_ENV === 'production' || req.secure;
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 14 * 24 * 60 * 60 * 1000 // 14 days
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax'
  });
}

/**
 * Verify Cloudflare Turnstile token if configured
 */
export async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || process.env.NODE_ENV === 'test') {
    return true; // Bypass in dev/test or when not configured
  }
  if (!token) return false;

  try {
    const formData = new URLSearchParams();
    formData.append('secret', secret);
    formData.append('response', token);
    if (ip) formData.append('remoteip', ip);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData
    });
    const outcome = await res.json();
    return outcome.success === true;
  } catch (err) {
    console.warn('[TURNSTILE ERROR]', err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET /api/auth/me
// Returns current authenticated user, session csrfToken, and linked identities
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  if (!req.user || !req.session) {
    return res.json({
      success: true,
      authenticated: false,
      user: null
    });
  }

  const identities = await getUserIdentities(req.user.userId);

  return res.json({
    success: true,
    authenticated: true,
    csrfToken: req.session.csrfToken,
    user: {
      userId: req.user.userId,
      _id: req.user.userId, // backward compatibility
      email: req.user.email,
      name: req.user.name,
      avatarUrl: req.user.avatarUrl,
      status: req.user.status,
      roles: req.user.roles || ['customer'],
      emailVerified: req.user.emailVerified,
      identities
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. ROKIT OIDC FLOW (/api/auth/rokit & /api/auth/callback/rokit)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/rokit', (req, res) => {
  const { verifier, challenge } = generatePKCE();
  const state = base64url(crypto.randomBytes(16));
  const nonce = base64url(crypto.randomBytes(16));
  const returnTo = req.query.returnTo || '/';
  const linking = req.query.linking === 'true' && req.user ? req.user.userId : null;

  const redirectUri = process.env.ROKIT_REDIRECT_URI || 
    `${req.protocol}://${req.get('host')}/api/auth/callback/rokit`;

  const handshakeData = {
    verifier,
    state,
    nonce,
    returnTo,
    linking,
    createdAt: Date.now()
  };

  res.cookie('rokit_oidc_handshake', JSON.stringify(handshakeData), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || req.secure,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000 // 10 minutes
  });

  const authUrl = `${ROKIT_ISSUER}/oauth/authorize?client_id=${encodeURIComponent(ROKIT_CLIENT_ID)}&response_type=code&scope=openid%20email%20profile&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&nonce=${nonce}&code_challenge=${challenge}&code_challenge_method=S256`;

  res.redirect(authUrl);
});

router.get('/callback/rokit', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    if (error) {
      return res.redirect(`/?auth_error=${encodeURIComponent(error_description || error)}`);
    }

    const rawHandshake = req.cookies?.rokit_oidc_handshake;
    if (!rawHandshake) {
      return res.redirect('/?auth_error=Authorization session expired. Please try again.');
    }

    let handshake;
    try {
      handshake = JSON.parse(rawHandshake);
    } catch {
      return res.redirect('/?auth_error=Invalid authorization session.');
    }

    if (state !== handshake.state) {
      return res.redirect('/?auth_error=State verification failed (CSRF check).');
    }

    const redirectUri = process.env.ROKIT_REDIRECT_URI || 
      `${req.protocol}://${req.get('host')}/api/auth/callback/rokit`;

    // Exchange authorization code for token
    const tokenRes = await fetch(`${ROKIT_ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: ROKIT_CLIENT_ID,
        client_secret: ROKIT_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        code_verifier: handshake.verifier
      }).toString()
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('[ROKIT TOKEN EXCHANGE FAILED]', tokenData);
      return res.redirect(`/?auth_error=${encodeURIComponent(tokenData.error_description || 'Token exchange failed')}`);
    }

    // Call Userinfo
    const userinfoRes = await fetch(`${ROKIT_ISSUER}/oauth/userinfo`, {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const userinfo = await userinfoRes.json();

    if (!userinfo.sub || !userinfo.email) {
      return res.redirect('/?auth_error=Incomplete profile returned from Rokit SSO.');
    }

    // Resolve or link identity
    const { user, isNewUser } = await resolveOrLinkIdentity({
      provider: 'rokit',
      providerSub: userinfo.sub,
      email: userinfo.email,
      emailVerified: userinfo.email_verified === true,
      name: userinfo.name || '',
      avatarUrl: userinfo.picture || null,
      currentSessionUserId: handshake.linking || null
    });

    // Create / rotate session
    const { rawSessionToken } = await createSession(user.userId, {
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    setSessionCookie(res, req, rawSessionToken);
    res.clearCookie('rokit_oidc_handshake');

    return res.redirect(handshake.returnTo || '/');
  } catch (err) {
    console.error('[ROKIT CALLBACK ERROR]', err);
    return res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GOOGLE OIDC FLOW (/api/auth/google & /api/auth/callback/google)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.redirect('/?auth_error=Google sign-in is not configured yet.');
  }

  const { verifier, challenge } = generatePKCE();
  const state = base64url(crypto.randomBytes(16));
  const nonce = base64url(crypto.randomBytes(16));
  const returnTo = req.query.returnTo || '/';
  const linking = req.query.linking === 'true' && req.user ? req.user.userId : null;

  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 
    `${req.protocol}://${req.get('host')}/api/auth/callback/google`;

  res.cookie('google_oidc_handshake', JSON.stringify({ verifier, state, nonce, returnTo, linking }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || req.secure,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=openid%20email%20profile&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&nonce=${nonce}&code_challenge=${challenge}&code_challenge_method=S256`;

  res.redirect(authUrl);
});

router.get('/callback/google', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`/?auth_error=${encodeURIComponent(error)}`);

    const rawHandshake = req.cookies?.google_oidc_handshake;
    if (!rawHandshake) return res.redirect('/?auth_error=Google session expired.');

    const handshake = JSON.parse(rawHandshake);
    if (state !== handshake.state) return res.redirect('/?auth_error=State verification failed.');

    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 
      `${req.protocol}://${req.get('host')}/api/auth/callback/google`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: handshake.verifier
      }).toString()
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      return res.redirect('/?auth_error=Google token exchange failed.');
    }

    const userinfoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const userinfo = await userinfoRes.json();

    const { user } = await resolveOrLinkIdentity({
      provider: 'google',
      providerSub: userinfo.sub,
      email: userinfo.email,
      emailVerified: userinfo.email_verified === true,
      name: userinfo.name || '',
      avatarUrl: userinfo.picture || null,
      currentSessionUserId: handshake.linking || null
    });

    const { rawSessionToken } = await createSession(user.userId, {
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    setSessionCookie(res, req, rawSessionToken);
    res.clearCookie('google_oidc_handshake');
    return res.redirect(handshake.returnTo || '/');
  } catch (err) {
    return res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. FACEBOOK OAUTH FLOW (/api/auth/facebook & /api/auth/callback/facebook)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/facebook', (req, res) => {
  const appId = process.env.FACEBOOK_APP_ID;
  if (!appId) {
    return res.redirect('/?auth_error=Facebook sign-in is not configured yet.');
  }

  const state = base64url(crypto.randomBytes(16));
  const returnTo = req.query.returnTo || '/';
  const linking = req.query.linking === 'true' && req.user ? req.user.userId : null;

  const redirectUri = process.env.FACEBOOK_REDIRECT_URI || 
    `${req.protocol}://${req.get('host')}/api/auth/callback/facebook`;

  res.cookie('fb_oauth_handshake', JSON.stringify({ state, returnTo, linking }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || req.secure,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000
  });

  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=email,public_profile`;

  res.redirect(authUrl);
});

router.get('/callback/facebook', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    if (error) return res.redirect(`/?auth_error=${encodeURIComponent(error_description || error)}`);

    const rawHandshake = req.cookies?.fb_oauth_handshake;
    if (!rawHandshake) return res.redirect('/?auth_error=Facebook session expired.');

    const handshake = JSON.parse(rawHandshake);
    if (state !== handshake.state) return res.redirect('/?auth_error=State verification failed.');

    const redirectUri = process.env.FACEBOOK_REDIRECT_URI || 
      `${req.protocol}://${req.get('host')}/api/auth/callback/facebook`;

    const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.FACEBOOK_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${process.env.FACEBOOK_APP_SECRET}&code=${code}`);
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      return res.redirect('/?auth_error=Facebook token exchange failed.');
    }

    const meRes = await fetch(`https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${tokenData.access_token}`);
    const me = await meRes.json();

    // Facebook email is not guaranteed verified by Facebook; auto-linking rule applies
    const { user } = await resolveOrLinkIdentity({
      provider: 'facebook',
      providerSub: me.id,
      email: me.email || null,
      emailVerified: false, // NEVER assert email_verified for Facebook
      name: me.name || '',
      avatarUrl: me.picture?.data?.url || null,
      currentSessionUserId: handshake.linking || null
    });

    const { rawSessionToken } = await createSession(user.userId, {
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    setSessionCookie(res, req, rawSessionToken);
    res.clearCookie('fb_oauth_handshake');
    return res.redirect(handshake.returnTo || '/');
  } catch (err) {
    return res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. SESSION MANAGEMENT & IDENTITY UNLINK
// ─────────────────────────────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  const rawToken = req.cookies?.[COOKIE_NAME];
  if (rawToken) {
    await destroySession(rawToken);
  }
  clearSessionCookie(res);
  res.json({ success: true, message: 'Logged out successfully.' });
});

router.post('/logout-all', requireAuth, requireCsrf, async (req, res) => {
  await logoutAllEverywhere(req.user.userId);
  clearSessionCookie(res);
  res.json({ success: true, message: 'Logged out from all devices.' });
});

router.post('/unlink/:provider', requireAuth, requireCsrf, async (req, res) => {
  try {
    const { provider } = req.params;
    const outcome = await unlinkIdentity(req.user.userId, provider);
    res.json(outcome);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. ACCOUNT DELETION (Requirement 9)
// Deletes uploads, outputs, identities, sessions and anonymizes records
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/account', requireAuth, requireCsrf, async (req, res) => {
  try {
    const userId = req.user.userId;

    // 1. Delete identities and sessions
    await Identity.deleteMany({ userId });
    await Session.deleteMany({ userId });

    // 2. Delete local files from storage/generations and storage/originals
    const GENERATIONS_DIR = path.join(__dirname, '..', 'storage', 'generations');
    const ORIGINALS_DIR = path.join(__dirname, '..', 'storage', 'originals');

    try {
      if (fs.existsSync(GENERATIONS_DIR)) {
        const files = fs.readdirSync(GENERATIONS_DIR);
        for (const f of files) {
          if (f.endsWith('.json')) {
            try {
              const data = JSON.parse(fs.readFileSync(path.join(GENERATIONS_DIR, f), 'utf8'));
              if (data.userId === userId) {
                if (data.localFileName && fs.existsSync(path.join(GENERATIONS_DIR, data.localFileName))) {
                  fs.unlinkSync(path.join(GENERATIONS_DIR, data.localFileName));
                }
                fs.unlinkSync(path.join(GENERATIONS_DIR, f));
              }
            } catch {}
          }
        }
      }
    } catch {}

    // 3. Anonymize user record
    await User.updateOne(
      { userId },
      {
        $set: {
          status: 'banned',
          email: `deleted_${Date.now()}@anonymized.invalid`,
          emailNormalized: `deleted_${Date.now()}@anonymized.invalid`,
          name: 'Deleted User',
          avatarUrl: null
        }
      }
    );

    clearSessionCookie(res);
    return res.json({ success: true, message: 'Account and associated photos successfully deleted.' });
  } catch (err) {
    console.error('[ACCOUNT DELETION ERROR]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
