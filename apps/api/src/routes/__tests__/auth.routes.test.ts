import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, sessions } from '../../db/schema.js';
import authRoutes from '../auth.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(cookie);
  app.decorateRequest('user', undefined);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  // Clean up test data
  await db.delete(sessions);
  await db.delete(users);
  const { pool } = await import('../../db/client.js');
  await pool.end();
});

afterEach(async () => {
  // Clean up between tests
  await db.delete(sessions);
  await db.delete(users);
});

const TEST_USER = {
  email: 'test@example.com',
  password: 'securepassword123',
  display_name: 'Test User',
};

describe('POST /auth/signup', () => {
  it('creates a user and returns access token + user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: TEST_USER,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.access).toBeDefined();
    expect(body.user.email).toBe(TEST_USER.email);
    expect(body.user.display_name).toBe(TEST_USER.display_name);
    expect(body.user.is_superadmin).toBe(false);
    expect(body.user.id).toHaveLength(26);

    // Check refresh cookie is set
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(String(setCookie)).toContain('refresh=');
  });

  it('flips refresh cookie to SameSite=None; Secure when CROSS_SITE_COOKIES=true', async () => {
    const original = process.env.CROSS_SITE_COOKIES;
    process.env.CROSS_SITE_COOKIES = 'true';
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { ...TEST_USER, email: `crosssite-${Date.now()}@example.com` },
      });
      expect(res.statusCode).toBe(201);
      const cookieHeader = String(res.headers['set-cookie']);
      expect(cookieHeader).toContain('refresh=');
      expect(cookieHeader).toMatch(/SameSite=None/i);
      expect(cookieHeader).toMatch(/; ?Secure/i);
    } finally {
      process.env.CROSS_SITE_COOKIES = original;
    }
  });

  it('returns 409 on duplicate email', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: TEST_USER,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: TEST_USER,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Conflict');
  });

  it('returns 400 on invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'not-an-email', password: 'short' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Validation');
  });
});

describe('POST /auth/login', () => {
  beforeAll(async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: TEST_USER,
    });
  });

  it('returns access token + user with valid credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: TEST_USER.email, password: TEST_USER.password },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access).toBeDefined();
    expect(body.user.email).toBe(TEST_USER.email);
  });

  it('returns 401 with wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: TEST_USER.email, password: 'wrongpassword' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with unknown email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'unknown@example.com', password: 'anything' },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  it('returns a fresh access token with valid cookie', async () => {
    // Signup to get a refresh cookie
    const signupRes = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: TEST_USER,
    });

    const setCookieHeader = String(signupRes.headers['set-cookie']);
    const cookieMatch = setCookieHeader.match(/refresh=([^;]+)/);
    expect(cookieMatch).toBeTruthy();
    const refreshValue = decodeURIComponent(cookieMatch![1]!);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { refresh: refreshValue },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access).toBeDefined();
  });

  it('returns 401 without cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with invalid cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { refresh: 'invalid-cookie-value' },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('returns 204 and clears the cookie', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: TEST_USER,
    });

    const setCookieHeader = String(signupRes.headers['set-cookie']);
    const cookieMatch = setCookieHeader.match(/refresh=([^;]+)/);
    const refreshValue = cookieMatch![1]!;

    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { refresh: refreshValue },
    });

    expect(res.statusCode).toBe(204);
  });

  it('returns 204 even without cookie (idempotent)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
    });

    expect(res.statusCode).toBe(204);
  });
});

describe('GET /auth/me', () => {
  it('returns user with valid bearer token', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: TEST_USER,
    });

    const { access } = signupRes.json();

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${access}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.email).toBe(TEST_USER.email);
    expect(body.display_name).toBe(TEST_USER.display_name);
  });

  it('returns 401 without token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: 'Bearer invalid.token.here' },
    });

    expect(res.statusCode).toBe(401);
  });
});
