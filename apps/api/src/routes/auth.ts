import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { SignupReq, LoginReq } from '@meeting-app/shared';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signAccess } from '../auth/jwt.js';
import { createSession, rotateSession, revokeSession } from '../auth/sessions.js';
import {
  getAuthorizationUrl,
  validateAuthorizationCode,
  fetchGoogleUser,
} from '../auth/google.js';
import { requireAuth } from '../plugins/auth.js';
import { errorHandler } from '../plugins/error-handler.js';
import * as invitesRepo from '../repositories/invites.js';
import { sendWelcomeEmail } from '../services/email.js';
import { crossSiteCookieOpts } from '../auth/cookie-opts.js';

const REFRESH_COOKIE = 'refresh';

function toUserResponse(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    display_name: u.displayName,
    is_superadmin: u.isSuperadmin,
    created_at: u.createdAt.toISOString(),
  };
}

function parseRefreshCookie(
  raw: string | undefined,
): { sessionId: string; token: string } | null {
  if (!raw) return null;
  const colonIdx = raw.indexOf(':');
  if (colonIdx === -1) return null;
  const sessionId = raw.slice(0, colonIdx);
  const token = raw.slice(colonIdx + 1);
  if (sessionId.length !== 26 || !token) return null;
  return { sessionId, token };
}

export default async function authRoutes(app: FastifyInstance) {
  // Derive cookie paths from Fastify's prefix — single source of truth
  const prefix = app.prefix; // e.g. "/api/v0/auth"
  function setRefreshCookie(
    reply: import('fastify').FastifyReply,
    sessionId: string,
    refreshToken: string,
    expiresAt: Date,
  ) {
    reply.setCookie(REFRESH_COOKIE, `${sessionId}:${refreshToken}`, {
      ...crossSiteCookieOpts(prefix, 30 * 24 * 60 * 60),
      expires: expiresAt,
    });
  }

  // Delegate error handling to the shared errorHandler so auth routes inherit
  // the same 5xx sanitization policy.
  app.setErrorHandler(errorHandler);

  // Per-route rate limits for brute-force-sensitive surfaces. Picked up by
  // @fastify/rate-limit when registered in index.ts; harmless no-op in the
  // test harness where the plugin is not registered. Arbitrary `config` is
  // a Fastify-native pass-through — safe either way.
  const authRouteConfig = {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  };
  const refreshRouteConfig = {
    config: { rateLimit: { max: 60, timeWindow: '15 minutes' } },
  };

  // ── POST /auth/signup ──────────────────────────────────────────────
  app.post('/signup', authRouteConfig, async (request, reply) => {
    const body = SignupReq.parse(request.body);

    // Check email uniqueness
    const existing = await db.query.users.findFirst({
      where: eq(users.email, body.email),
    });
    if (existing) {
      return reply.code(409).send({
        error: 'Conflict',
        message: 'Email already registered',
        status_code: 409,
      });
    }

    const passwordHash = await hashPassword(body.password);
    const userId = ulid();

    await db.insert(users).values({
      id: userId,
      email: body.email,
      passwordHash,
      displayName: body.display_name,
    });

    const user = (await db.query.users.findFirst({
      where: eq(users.id, userId),
    }))!;

    // Auto-bind pending invites to this new user
    await invitesRepo.autoBindByEmail(body.email, userId);

    const { sessionId, refreshToken, expiresAt } =
      await createSession(userId);
    const access = await signAccess(userId, body.email);

    setRefreshCookie(reply, sessionId, refreshToken, expiresAt);
    sendWelcomeEmail({ displayName: body.display_name, email: body.email }).catch(() => {});
    return reply.code(201).send({ access, user: toUserResponse(user) });
  });

  // ── POST /auth/login ───────────────────────────────────────────────
  app.post('/login', authRouteConfig, async (request, reply) => {
    const body = LoginReq.parse(request.body);

    const user = await db.query.users.findFirst({
      where: eq(users.email, body.email),
    });
    if (!user || !user.passwordHash) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid credentials',
        status_code: 401,
      });
    }

    const valid = await verifyPassword(user.passwordHash, body.password);
    if (!valid) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid credentials',
        status_code: 401,
      });
    }

    // Auto-bind pending invites on login
    await invitesRepo.autoBindByEmail(user.email, user.id);

    const { sessionId, refreshToken, expiresAt } =
      await createSession(user.id);
    const access = await signAccess(user.id, user.email);

    setRefreshCookie(reply, sessionId, refreshToken, expiresAt);
    return reply.send({ access, user: toUserResponse(user) });
  });

  // ── POST /auth/refresh ─────────────────────────────────────────────
  app.post('/refresh', refreshRouteConfig, async (request, reply) => {
    const parsed = parseRefreshCookie(request.cookies[REFRESH_COOKIE]);
    if (!parsed) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Missing or invalid refresh token',
        status_code: 401,
      });
    }

    try {
      const { refreshToken, expiresAt, userId } = await rotateSession(
        parsed.token,
        parsed.sessionId,
      );

      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });
      if (!user) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'User not found',
          status_code: 401,
        });
      }

      const access = await signAccess(user.id, user.email);

      setRefreshCookie(reply, parsed.sessionId, refreshToken, expiresAt);
      return reply.send({ access });
    } catch {
      reply.clearCookie(REFRESH_COOKIE, { path: prefix });
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid or expired refresh token',
        status_code: 401,
      });
    }
  });

  // ── POST /auth/logout ──────────────────────────────────────────────
  app.post('/logout', async (request, reply) => {
    const parsed = parseRefreshCookie(request.cookies[REFRESH_COOKIE]);
    if (parsed) {
      await revokeSession(parsed.sessionId).catch(() => {});
    }
    reply.clearCookie(REFRESH_COOKIE, { path: prefix });
    return reply.code(204).send();
  });

  // ── GET /auth/google/start ─────────────────────────────────────────
  app.get('/google/start', async (_request, reply) => {
    const { url, state, codeVerifier } = getAuthorizationUrl();

    const oauthCookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: `${prefix}/google/callback`,
      maxAge: 600, // 10 minutes
    };

    reply.setCookie('google_state', state, oauthCookieOpts);
    reply.setCookie('google_code_verifier', codeVerifier, oauthCookieOpts);

    return reply.redirect(url.toString());
  });

  // ── GET /auth/google/callback ──────────────────────────────────────
  app.get('/google/callback', async (request, reply) => {
    const { code, state } = request.query as {
      code?: string;
      state?: string;
    };
    const storedState = request.cookies.google_state;
    const storedVerifier = request.cookies.google_code_verifier;

    // Clear OAuth cookies regardless of outcome
    reply.clearCookie('google_state', { path: `${prefix}/google/callback` });
    reply.clearCookie('google_code_verifier', {
      path: `${prefix}/google/callback`,
    });

    if (!code || !state || !storedState || !storedVerifier) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Missing OAuth parameters',
        status_code: 400,
      });
    }

    if (state !== storedState) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Invalid OAuth state',
        status_code: 400,
      });
    }

    const tokens = await validateAuthorizationCode(code, storedVerifier);
    const googleUser = await fetchGoogleUser(tokens.accessToken());

    // Resolve user: google_sub → email → create
    let user = await db.query.users.findFirst({
      where: eq(users.googleSub, googleUser.sub),
    });

    if (!user) {
      user = await db.query.users.findFirst({
        where: eq(users.email, googleUser.email),
      });

      if (user) {
        // Link Google sub to existing account
        await db
          .update(users)
          .set({ googleSub: googleUser.sub })
          .where(eq(users.id, user.id));
      } else {
        // Create new user
        const userId = ulid();
        await db.insert(users).values({
          id: userId,
          email: googleUser.email,
          displayName: googleUser.name,
          googleSub: googleUser.sub,
        });
        user = (await db.query.users.findFirst({
          where: eq(users.id, userId),
        }))!;
        sendWelcomeEmail({ displayName: googleUser.name, email: googleUser.email }).catch(() => {});
      }
    }

    // Auto-bind pending invites on Google login/signup
    await invitesRepo.autoBindByEmail(user.email, user.id);

    const { sessionId, refreshToken, expiresAt } =
      await createSession(user.id);
    const access = await signAccess(user.id, user.email);

    setRefreshCookie(reply, sessionId, refreshToken, expiresAt);

    // Pass the access JWT via the URL **fragment** (not the query string):
    // fragments are never sent to the server or logged by proxies, and the
    // browser strips them from the Referer header. The frontend callback
    // reads `window.location.hash`, hands the token to auth-store, then
    // wipes the hash via `history.replaceState` so it cannot leak from the
    // address bar via screenshots, password managers, or link previews.
    const webUrl = process.env.WEB_URL ?? 'http://localhost:5173';
    return reply.redirect(
      `${webUrl}/auth/callback#access=${encodeURIComponent(access)}`,
    );
  });

  // ── GET /auth/me ───────────────────────────────────────────────────
  app.get('/me', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = await db.query.users.findFirst({
      where: eq(users.id, request.user!.id),
    });

    if (!user) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'User not found',
        status_code: 401,
      });
    }

    return reply.send(toUserResponse(user));
  });
}
