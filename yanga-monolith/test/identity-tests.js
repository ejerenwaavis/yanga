import assert from 'node:assert';
import mongoose from 'mongoose';
import { 
  normalizeEmail, 
  hashSessionToken, 
  generateCsrfToken,
  createSession,
  rotateSession,
  validateSession,
  destroySession,
  logoutAllEverywhere,
  resolveOrLinkIdentity,
  unlinkIdentity,
  getUserIdentities
} from '../services/identityService.js';
import { 
  requireAuth, 
  requireActiveGeneration, 
  requireCsrf, 
  COOKIE_NAME 
} from '../middleware/sessionAuth.js';
import User from '../models/User.js';
import Identity from '../models/Identity.js';
import Session from '../models/Session.js';

const MONGODB_URI = process.env.MONGODB_URI || 
  'mongodb+srv://rokitonline:rOKItdatabaseaccess@cluster0.ykfdroi.mongodb.net/yanga?appName=Cluster0';

async function runTests() {
  console.log('🧪 Starting Yanga Phase 2 Identity & Session Test Suite...');
  
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGODB_URI);
  }

  const testSuffix = `test_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const testUserIds = [];

  try {
    // ─── 1. Email Normalization Tests ──────────────────────────────────────────
    console.log('\n--- 1. Email Normalization Tests ---');
    {
      assert.strictEqual(normalizeEmail('  User@Example.COM  '), 'user@example.com');
      assert.strictEqual(normalizeEmail('john.doe@gmail.com'), 'johndoe@gmail.com');
      assert.strictEqual(normalizeEmail('j.o.h.n.d.o.e+yanga@gmail.com'), 'johndoe@gmail.com');
      assert.strictEqual(normalizeEmail('jane.smith+promo@googlemail.com'), 'janesmith@gmail.com');
      assert.strictEqual(normalizeEmail('corporate.user+tag@company.com'), 'corporate.user+tag@company.com');
      console.log('✓ Email normalization handles Gmail dot/plus stripping and domain aliasing');
    }

    // ─── 2. Identity Creation & Re-login ──────────────────────────────────────
    console.log('\n--- 2. Identity Creation & Resolution Tests ---');
    let createdUser;
    {
      const res = await resolveOrLinkIdentity({
        provider: 'rokit',
        providerSub: `sub_rokit_${testSuffix}`,
        email: `${testSuffix}@rokitonline.com`,
        emailVerified: true,
        name: 'Test Rokit User',
        avatarUrl: 'https://example.com/avatar.png'
      });

      assert.strictEqual(res.isNewUser, true);
      assert.strictEqual(res.user.status, 'active');
      assert.strictEqual(res.user.emailVerified, true);
      assert.deepStrictEqual(res.user.roles, ['customer']);
      assert.strictEqual(res.identity.provider, 'rokit');
      createdUser = res.user;
      testUserIds.push(createdUser.userId);
      console.log('✓ Successfully created canonical user and Rokit identity');

      // Re-login with same provider and sub
      const reLogin = await resolveOrLinkIdentity({
        provider: 'rokit',
        providerSub: `sub_rokit_${testSuffix}`,
        email: `${testSuffix}@rokitonline.com`,
        emailVerified: true
      });
      assert.strictEqual(reLogin.isNewUser, false);
      assert.strictEqual(reLogin.user.userId, createdUser.userId);
      console.log('✓ Re-login resolves existing user');
    }

    // ─── 3. Verified Auto-Linking (Rokit + Google) ─────────────────────────────
    console.log('\n--- 3. Verified Auto-Linking Tests ---');
    {
      const googleRes = await resolveOrLinkIdentity({
        provider: 'google',
        providerSub: `sub_google_${testSuffix}`,
        email: `${testSuffix}@rokitonline.com`,
        emailVerified: true,
        name: 'Test Rokit User via Google'
      });

      assert.strictEqual(googleRes.isNewUser, false);
      assert.strictEqual(googleRes.user.userId, createdUser.userId);
      assert.strictEqual(googleRes.identity.provider, 'google');

      const identities = await getUserIdentities(createdUser.userId);
      assert.strictEqual(identities.length, 2);
      console.log('✓ Verified Google identity automatically linked to verified Rokit user with matching email');
    }

    // ─── 4. Account Takeover Prevention (Facebook & Unverified) ───────────────
    console.log('\n--- 4. Account Takeover Prevention Tests ---');
    {
      // Facebook NEVER auto-links by email
      let fbThrew = false;
      try {
        await resolveOrLinkIdentity({
          provider: 'facebook',
          providerSub: `sub_fb_${testSuffix}`,
          email: `${testSuffix}@rokitonline.com`,
          emailVerified: false,
          name: 'FB Impostor'
        });
      } catch (err) {
        fbThrew = true;
        assert.strictEqual(err.code, 'FACEBOOK_LINK_REQUIRED');
      }
      assert.ok(fbThrew, 'Facebook with matching email MUST throw FACEBOOK_LINK_REQUIRED');
      console.log('✓ Facebook auto-linking blocked to prevent email-spoof account takeover');

      // Unverified provider with matching email MUST be blocked
      let unverifiedThrew = false;
      try {
        await resolveOrLinkIdentity({
          provider: 'rokit',
          providerSub: `sub_unverified_${testSuffix}`,
          email: `${testSuffix}@rokitonline.com`,
          emailVerified: false
        });
      } catch (err) {
        unverifiedThrew = true;
        assert.strictEqual(err.code, 'EMAIL_VERIFICATION_REQUIRED');
      }
      assert.ok(unverifiedThrew, 'Unverified provider MUST throw EMAIL_VERIFICATION_REQUIRED');
      console.log('✓ Unverified provider auto-linking correctly blocked');
    }

    // ─── 5. Explicit Linking From Settings ─────────────────────────────────────
    console.log('\n--- 5. Explicit Identity Linking from Settings Tests ---');
    {
      const linkedFb = await resolveOrLinkIdentity({
        provider: 'facebook',
        providerSub: `sub_fb_explicit_${testSuffix}`,
        email: `fb_${testSuffix}@facebook.com`,
        emailVerified: false,
        name: 'Explicit FB',
        currentSessionUserId: createdUser.userId
      });

      assert.strictEqual(linkedFb.isNewUser, false);
      assert.strictEqual(linkedFb.user.userId, createdUser.userId);
      assert.strictEqual(linkedFb.identity.provider, 'facebook');

      const userIdentities = await getUserIdentities(createdUser.userId);
      assert.strictEqual(userIdentities.length, 3);
      console.log('✓ User can explicitly link Facebook from authenticated settings');

      // Attempt to link the same Facebook account to a second user must fail
      const otherUserRes = await resolveOrLinkIdentity({
        provider: 'rokit',
        providerSub: `sub_other_${testSuffix}`,
        email: `other_${testSuffix}@rokitonline.com`,
        emailVerified: true
      });
      testUserIds.push(otherUserRes.user.userId);

      let stealThrew = false;
      try {
        await resolveOrLinkIdentity({
          provider: 'facebook',
          providerSub: `sub_fb_explicit_${testSuffix}`,
          currentSessionUserId: otherUserRes.user.userId
        });
      } catch (err) {
        stealThrew = true;
      }
      assert.ok(stealThrew, 'Cannot link an identity already owned by another user');
      console.log('✓ Prevented stealing an already-claimed identity');
    }

    // ─── 6. Identity Unlinking Rules ───────────────────────────────────────────
    console.log('\n--- 6. Identity Unlinking Tests ---');
    {
      // createdUser has 3 identities (rokit, google, facebook). Unlinking facebook should succeed.
      const unlinkRes = await unlinkIdentity(createdUser.userId, 'facebook');
      assert.strictEqual(unlinkRes.success, true);

      const remaining = await getUserIdentities(createdUser.userId);
      assert.strictEqual(remaining.length, 2);
      assert.ok(!remaining.some(i => i.provider === 'facebook'));
      console.log('✓ Successfully unlinked Facebook identity');

      // Single-identity user cannot unlink
      const singleUserRes = await resolveOrLinkIdentity({
        provider: 'rokit',
        providerSub: `sub_single_${testSuffix}`,
        email: `single_${testSuffix}@rokitonline.com`,
        emailVerified: true
      });
      testUserIds.push(singleUserRes.user.userId);

      let singleUnlinkThrew = false;
      try {
        await unlinkIdentity(singleUserRes.user.userId, 'rokit');
      } catch (err) {
        singleUnlinkThrew = true;
      }
      assert.ok(singleUnlinkThrew, 'Cannot unlink the last remaining identity');
      console.log('✓ System prohibits unlinking the only remaining identity');
    }

    // ─── 7. Session Lifecycle, Sliding Expiry & Session Rotation ───────────────
    console.log('\n--- 7. Session Lifecycle & Security Tests ---');
    {
      const { rawSessionToken, csrfToken, session } = await createSession(createdUser.userId);
      assert.ok(rawSessionToken);
      assert.ok(csrfToken);
      assert.strictEqual(session.userId, createdUser.userId);
      assert.strictEqual(session.sessionId, hashSessionToken(rawSessionToken));

      // Validate session
      const valid = await validateSession(rawSessionToken);
      assert.ok(valid);
      assert.strictEqual(valid.user.userId, createdUser.userId);
      assert.strictEqual(valid.session.csrfToken, csrfToken);
      console.log('✓ Session created and validated via SHA-256 token hash');

      // Session Rotation on login
      const rotated = await rotateSession(rawSessionToken, createdUser.userId);
      assert.notStrictEqual(rotated.rawSessionToken, rawSessionToken);
      
      const oldCheck = await validateSession(rawSessionToken);
      assert.strictEqual(oldCheck, null, 'Old session token must be invalidated');

      const newCheck = await validateSession(rotated.rawSessionToken);
      assert.ok(newCheck, 'Rotated session token must be valid');
      console.log('✓ Session rotation invalidates previous token to prevent session fixation');

      // Destroy session
      await destroySession(rotated.rawSessionToken);
      const afterDestroy = await validateSession(rotated.rawSessionToken);
      assert.strictEqual(afterDestroy, null);
      console.log('✓ Destroy session successfully logs out single session');

      // Logout everywhere
      await createSession(createdUser.userId);
      await createSession(createdUser.userId);
      let count = await Session.countDocuments({ userId: createdUser.userId });
      assert.strictEqual(count, 2);

      await logoutAllEverywhere(createdUser.userId);
      count = await Session.countDocuments({ userId: createdUser.userId });
      assert.strictEqual(count, 0);
      console.log('✓ Logout all everywhere clears all active sessions for the user');
    }

    // ─── 8. Middleware & User Status Enforcement ──────────────────────────────
    console.log('\n--- 8. Middleware Status Enforcement Tests ---');
    {
      // Mock Response Helper
      function mockResponse() {
        const res = {
          statusCode: 200,
          jsonData: null,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(data) {
            this.jsonData = data;
            return this;
          }
        };
        return res;
      }

      // Active user passes
      const reqActive = { user: { status: 'active', userId: createdUser.userId }, session: {} };
      let passedActive = false;
      requireAuth(reqActive, mockResponse(), () => { passedActive = true; });
      assert.ok(passedActive, 'Active user must pass requireAuth');

      let genPassedActive = false;
      requireActiveGeneration(reqActive, mockResponse(), () => { genPassedActive = true; });
      assert.ok(genPassedActive, 'Active user must pass requireActiveGeneration');
      console.log('✓ Active user passes authentication & generation authorization');

      // Suspended user blocked at requireAuth
      const reqSuspended = { user: { status: 'suspended', userId: 'suspended_user' }, session: {} };
      const resSuspended = mockResponse();
      let passedSuspended = false;
      requireAuth(reqSuspended, resSuspended, () => { passedSuspended = true; });
      assert.strictEqual(passedSuspended, false);
      assert.strictEqual(resSuspended.statusCode, 403);
      assert.strictEqual(resSuspended.jsonData?.suspended, true);
      console.log('✓ Suspended user blocked by requireAuth with 403 Forbidden');

      // Banned user blocked at requireAuth
      const reqBanned = { user: { status: 'banned', userId: 'banned_user' }, session: {} };
      const resBanned = mockResponse();
      let passedBanned = false;
      requireAuth(reqBanned, resBanned, () => { passedBanned = true; });
      assert.strictEqual(passedBanned, false);
      assert.strictEqual(resBanned.statusCode, 403);
      assert.strictEqual(resBanned.jsonData?.banned, true);
      console.log('✓ Banned user blocked by requireAuth with 403 Forbidden');

      // Restricted user: passes requireAuth, BLOCKED at requireActiveGeneration
      const reqRestricted = { user: { status: 'restricted', userId: 'restricted_user' }, session: {} };
      let passedRestrictedAuth = false;
      requireAuth(reqRestricted, mockResponse(), () => { passedRestrictedAuth = true; });
      assert.ok(passedRestrictedAuth, 'Restricted user can still access read-only auth');

      const resRestrictedGen = mockResponse();
      let passedRestrictedGen = false;
      requireActiveGeneration(reqRestricted, resRestrictedGen, () => { passedRestrictedGen = true; });
      assert.strictEqual(passedRestrictedGen, false);
      assert.strictEqual(resRestrictedGen.statusCode, 403);
      assert.strictEqual(resRestrictedGen.jsonData?.restricted, true);
      console.log('✓ Restricted user allowed read-only access but blocked from generating photos');
    }

    // ─── 9. CSRF Protection Middleware Tests ──────────────────────────────────
    console.log('\n--- 9. CSRF Protection Tests ---');
    {
      function mockResponse() {
        const res = {
          statusCode: 200,
          jsonData: null,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(data) {
            this.jsonData = data;
            return this;
          }
        };
        return res;
      }

      const activeCsrfToken = 'valid_session_csrf_token_secret';

      // 1. GET requests bypass CSRF
      const reqGet = { method: 'GET', cookies: { [COOKIE_NAME]: 'token' }, session: { csrfToken: activeCsrfToken } };
      let getPassed = false;
      requireCsrf(reqGet, mockResponse(), () => { getPassed = true; });
      assert.ok(getPassed, 'GET requests should bypass CSRF');

      // 2. POST with matching X-CSRF-Token passes
      const reqValidPost = {
        method: 'POST',
        path: '/api/generate',
        cookies: { [COOKIE_NAME]: 'token' },
        headers: { 'x-csrf-token': activeCsrfToken },
        session: { csrfToken: activeCsrfToken }
      };
      let postPassed = false;
      requireCsrf(reqValidPost, mockResponse(), () => { postPassed = true; });
      assert.ok(postPassed, 'POST with valid X-CSRF-Token must pass');

      // 3. POST with missing X-CSRF-Token rejected
      const reqMissingPost = {
        method: 'POST',
        path: '/api/generate',
        cookies: { [COOKIE_NAME]: 'token' },
        headers: {},
        session: { csrfToken: activeCsrfToken }
      };
      const resMissing = mockResponse();
      let missingPassed = false;
      requireCsrf(reqMissingPost, resMissing, () => { missingPassed = true; });
      assert.strictEqual(missingPassed, false);
      assert.strictEqual(resMissing.statusCode, 403);

      // 4. POST with invalid X-CSRF-Token rejected
      const reqInvalidPost = {
        method: 'POST',
        path: '/api/generate',
        cookies: { [COOKIE_NAME]: 'token' },
        headers: { 'x-csrf-token': 'attacker_fake_token' },
        session: { csrfToken: activeCsrfToken }
      };
      const resInvalid = mockResponse();
      let invalidPassed = false;
      requireCsrf(reqInvalidPost, resInvalid, () => { invalidPassed = true; });
      assert.strictEqual(invalidPassed, false);
      assert.strictEqual(resInvalid.statusCode, 403);
      console.log('✓ CSRF middleware strictly validates X-CSRF-Token header on state-changing requests');
    }

    console.log('\n=========================================');
    console.log('🎉 ALL PHASE 2 TESTS PASSED SUCCESSFULLY!');
    console.log('=========================================\n');
  } finally {
    // Clean up created test users, identities, and sessions
    if (testUserIds.length > 0) {
      await User.deleteMany({ userId: { $in: testUserIds } });
      await Identity.deleteMany({ userId: { $in: testUserIds } });
      await Session.deleteMany({ userId: { $in: testUserIds } });
    }
    await mongoose.disconnect();
  }
}

runTests().catch((err) => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
