import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import User from '../models/User.js';
import Identity from '../models/Identity.js';
import Session from '../models/Session.js';

/**
 * Normalizes email for deduplication
 * - Lowercase & trim
 * - For Gmail/Googlemail: remove dots from username, strip +tags
 */
export function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const trimmed = email.toLowerCase().trim();
  const parts = trimmed.split('@');
  if (parts.length !== 2) return trimmed;

  let [local, domain] = parts;
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
    const plusIndex = local.indexOf('+');
    if (plusIndex !== -1) {
      local = local.substring(0, plusIndex);
    }
    domain = 'gmail.com';
  }

  return `${local}@${domain}`;
}

/**
 * Hash session token with SHA-256 for secure storage at rest
 */
export function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate CSRF token
 */
export function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a new session with 14-day sliding expiry and CSRF token
 */
export async function createSession(userId, { ip = null, userAgent = null } = {}) {
  const rawSessionToken = crypto.randomBytes(32).toString('hex');
  const csrfToken = generateCsrfToken();
  const sessionId = hashSessionToken(rawSessionToken);
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

  const session = await Session.create({
    sessionId,
    userId,
    csrfToken,
    ip,
    userAgent,
    lastSeenAt: new Date(),
    expiresAt
  });

  return { rawSessionToken, csrfToken, session };
}

/**
 * Rotate an existing session on login to prevent session fixation attacks
 */
export async function rotateSession(oldRawToken, userId, meta = {}) {
  if (oldRawToken) {
    try {
      await Session.deleteOne({ sessionId: hashSessionToken(oldRawToken) });
    } catch {}
  }
  return await createSession(userId, meta);
}

/**
 * Validate incoming raw session token and update sliding expiration
 */
export async function validateSession(rawSessionToken) {
  if (!rawSessionToken) return null;
  const hashed = hashSessionToken(rawSessionToken);

  const session = await Session.findOne({ sessionId: hashed });
  if (!session) return null;
  if (session.expiresAt && session.expiresAt < new Date()) {
    await Session.deleteOne({ _id: session._id });
    return null;
  }

  const user = await User.findOne({ userId: session.userId });
  if (!user) return null;

  // Slide expiration if older than 1 hour since last seen
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  if (!session.lastSeenAt || session.lastSeenAt.getTime() < oneHourAgo) {
    session.lastSeenAt = new Date();
    session.expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await session.save();
  }

  return { session, user };
}

/**
 * Terminate a single session
 */
export async function destroySession(rawSessionToken) {
  if (!rawSessionToken) return;
  await Session.deleteOne({ sessionId: hashSessionToken(rawSessionToken) });
}

/**
 * Log out everywhere: Invalidate all sessions for a specific user
 */
export async function logoutAllEverywhere(userId) {
  if (!userId) return;
  await Session.deleteMany({ userId });
}

/**
 * Identity Linking & Resolution (Account takeover prevention)
 *
 * Rules:
 * 1. Same provider + sub -> log in.
 * 2. If logged in and linking -> link to current user (prevent steal).
 * 3. Matching email -> auto-link ONLY if provider reports email_verified=true,
 *    existing user is emailVerified=true, AND provider is 'rokit' or 'google'.
 * 4. Facebook NEVER auto-links by email.
 * 5. Brand new user -> create canonical user + identity.
 */
export async function resolveOrLinkIdentity({
  provider,
  providerSub,
  email,
  emailVerified = false,
  name = '',
  avatarUrl = null,
  country = null,
  currentSessionUserId = null
}) {
  if (!provider || !providerSub) {
    throw new Error('Provider and providerSub are required');
  }

  const emailClean = (email || '').toLowerCase().trim();
  const emailNorm = normalizeEmail(emailClean);

  // 1. Check if identity already exists
  const existingIdentity = await Identity.findOne({ provider, providerSub });
  if (existingIdentity) {
    // If linking from settings and it's already linked to ANOTHER user:
    if (currentSessionUserId && existingIdentity.userId !== currentSessionUserId) {
      throw new Error(`This ${provider} account is already linked to another Yanga account.`);
    }

    const user = await User.findOne({ userId: existingIdentity.userId });
    if (!user) {
      throw new Error('User account for this identity could not be found.');
    }

    user.lastLoginAt = new Date();
    if (emailVerified && !user.emailVerified) {
      user.emailVerified = true;
    }
    if (name && !user.name) {
      user.name = name;
    }
    if (avatarUrl && !user.avatarUrl) {
      user.avatarUrl = avatarUrl;
    }
    await user.save();

    return { user, identity: existingIdentity, isNewUser: false };
  }

  // 2. Linking from account settings
  if (currentSessionUserId) {
    const user = await User.findOne({ userId: currentSessionUserId });
    if (!user) {
      throw new Error('Current session user not found.');
    }

    const newIdentity = await Identity.create({
      userId: currentSessionUserId,
      provider,
      providerSub,
      email: emailClean,
      emailVerified: !!emailVerified,
      linkedAt: new Date()
    });

    if (emailVerified && !user.emailVerified) {
      user.emailVerified = true;
      await user.save();
    }

    return { user, identity: newIdentity, isNewUser: false };
  }

  // 3. New identity with matching email
  if (emailNorm) {
    const existingUser = await User.findOne({ emailNormalized: emailNorm });
    if (existingUser) {
      // Auto-linking rules:
      // Rokit or Google: auto-link ONLY if BOTH provider & existing user are verified
      const canAutoLink = 
        (provider === 'rokit' || provider === 'google') && 
        emailVerified === true && 
        existingUser.emailVerified === true;

      if (canAutoLink) {
        const linkedIdentity = await Identity.create({
          userId: existingUser.userId,
          provider,
          providerSub,
          email: emailClean,
          emailVerified: true,
          linkedAt: new Date()
        });

        existingUser.lastLoginAt = new Date();
        await existingUser.save();
        return { user: existingUser, identity: linkedIdentity, isNewUser: false };
      }

      // If Facebook or unverified: NEVER auto-link!
      if (provider === 'facebook') {
        const err = new Error('An account with this email already exists. Please sign in with Rokit or Google first, then link Facebook in your account settings.');
        err.code = 'FACEBOOK_LINK_REQUIRED';
        throw err;
      }

      const err = new Error('An account with this email already exists. Please verify your email with your existing sign-in provider before linking.');
      err.code = 'EMAIL_VERIFICATION_REQUIRED';
      throw err;
    }
  }

  // 4. Create Brand New User
  const newUserId = uuidv4();
  const newUser = await User.create({
    userId: newUserId,
    status: 'active',
    email: emailClean,
    emailNormalized: emailNorm,
    emailVerified: !!emailVerified,
    name: name || '',
    avatarUrl: avatarUrl || null,
    country: country || null,
    roles: ['customer'],
    lastLoginAt: new Date()
  });

  const newIdentity = await Identity.create({
    userId: newUserId,
    provider,
    providerSub,
    email: emailClean,
    emailVerified: !!emailVerified,
    linkedAt: new Date()
  });

  return { user: newUser, identity: newIdentity, isNewUser: true };
}

/**
 * Unlink an identity from an account (never remove the last one)
 */
export async function unlinkIdentity(userId, provider) {
  const identities = await Identity.find({ userId });
  if (identities.length <= 1) {
    throw new Error('You cannot remove your only sign-in method.');
  }

  const target = identities.find(i => i.provider === provider);
  if (!target) {
    throw new Error(`No ${provider} identity linked to this account.`);
  }

  await Identity.deleteOne({ _id: target._id });
  return { success: true, message: `Successfully unlinked ${provider}.` };
}

/**
 * Get all linked identities for a user
 */
export async function getUserIdentities(userId) {
  return await Identity.find({ userId }).select('provider email emailVerified linkedAt');
}
