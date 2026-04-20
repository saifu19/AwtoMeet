import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { api, ApiError, API_PREFIX } from '../api';
import { setAccessToken, getAccessToken } from '../auth-store';

const API_URL = 'http://localhost:3001';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  setAccessToken(null);
});
afterAll(() => server.close());

describe('api', () => {
  it('attaches Bearer header when token exists', async () => {
    setAccessToken('my-token');
    server.use(
      http.get(`${API_URL}${API_PREFIX}/test`, ({ request }) => {
        const auth = request.headers.get('authorization');
        return HttpResponse.json({ auth });
      }),
    );

    const res = await api<{ auth: string }>('/test');
    expect(res.auth).toBe('Bearer my-token');
  });

  it('sends request without auth header when no token', async () => {
    server.use(
      http.get(`${API_URL}${API_PREFIX}/test`, ({ request }) => {
        const auth = request.headers.get('authorization');
        return HttpResponse.json({ auth });
      }),
    );

    const res = await api<{ auth: string | null }>('/test');
    expect(res.auth).toBeNull();
  });

  it('auto-refreshes on 401 and retries', async () => {
    setAccessToken('expired-token');
    let callCount = 0;

    server.use(
      http.get(`${API_URL}${API_PREFIX}/test`, ({ request }) => {
        callCount++;
        const auth = request.headers.get('authorization');
        if (auth === 'Bearer expired-token') {
          return new HttpResponse(null, { status: 401 });
        }
        return HttpResponse.json({ ok: true });
      }),
      http.post(`${API_URL}${API_PREFIX}/auth/refresh`, () => {
        return HttpResponse.json({ access: 'new-token' });
      }),
    );

    const res = await api<{ ok: boolean }>('/test');
    expect(res.ok).toBe(true);
    expect(callCount).toBe(2);
    expect(getAccessToken()).toBe('new-token');
  });

  it('clears token and throws when refresh fails', async () => {
    setAccessToken('expired-token');

    server.use(
      http.get(`${API_URL}${API_PREFIX}/test`, () => {
        return new HttpResponse(null, { status: 401 });
      }),
      http.post(`${API_URL}${API_PREFIX}/auth/refresh`, () => {
        return new HttpResponse(null, { status: 401 });
      }),
    );

    await expect(api('/test')).rejects.toThrow(ApiError);
    expect(getAccessToken()).toBeNull();
  });

  it('throws ApiError on non-401 errors', async () => {
    server.use(
      http.get(`${API_URL}${API_PREFIX}/test`, () => {
        return new HttpResponse('Not Found', { status: 404 });
      }),
    );

    await expect(api('/test')).rejects.toThrow(ApiError);
  });

  it('parses M10 JSON error response format', async () => {
    server.use(
      http.post(`${API_URL}${API_PREFIX}/test`, () => {
        return HttpResponse.json(
          { error: 'Conflict', message: 'Email already registered', status_code: 409 },
          { status: 409 },
        );
      }),
    );

    try {
      await api('/test', { method: 'POST' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(409);
      expect(apiErr.message).toBe('Email already registered');
      expect(apiErr.body).toEqual({
        error: 'Conflict',
        message: 'Email already registered',
        status_code: 409,
      });
    }
  });

  it('returns undefined for 204 responses', async () => {
    server.use(
      http.post(`${API_URL}${API_PREFIX}/test`, () => {
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const res = await api('/test', { method: 'POST' });
    expect(res).toBeUndefined();
  });
});
