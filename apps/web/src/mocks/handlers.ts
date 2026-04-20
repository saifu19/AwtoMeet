import { http, HttpResponse } from 'msw';
import { API_PREFIX } from '@/lib/api';

const MOCK_USER = {
  id: '01JA0000000000000000000001',
  email: 'test@example.com',
  display_name: 'Test User',
  is_superadmin: false,
  created_at: '2025-01-01T00:00:00.000Z',
};

const MOCK_ACCESS_TOKEN = 'mock-access-token';
let isAuthenticated = false;

export function createHandlers(baseUrl = '') {
  return [
    // POST /auth/signup → 201 AuthRes (matches M10)
    http.post(`${baseUrl}${API_PREFIX}/auth/signup`, async ({ request }) => {
      const body = (await request.json()) as Record<string, string>;

      if (!body.email || !body.password || !body.display_name) {
        return HttpResponse.json(
          { error: 'Validation', message: 'Missing required fields', status_code: 400 },
          { status: 400 },
        );
      }

      if (body.password.length < 8) {
        return HttpResponse.json(
          { error: 'Validation', message: 'password: String must contain at least 8 character(s)', status_code: 400 },
          { status: 400 },
        );
      }

      isAuthenticated = true;
      return HttpResponse.json(
        {
          access: MOCK_ACCESS_TOKEN,
          user: { ...MOCK_USER, email: body.email, display_name: body.display_name },
        },
        { status: 201 },
      );
    }),

    // POST /auth/login → 200 AuthRes (matches M10)
    http.post(`${baseUrl}${API_PREFIX}/auth/login`, async ({ request }) => {
      const body = (await request.json()) as Record<string, string>;

      if (!body.email || !body.password) {
        return HttpResponse.json(
          { error: 'Validation', message: 'Missing required fields', status_code: 400 },
          { status: 400 },
        );
      }

      // Simulate invalid credentials for a specific email
      if (body.email === 'wrong@example.com') {
        return HttpResponse.json(
          { error: 'Unauthorized', message: 'Invalid credentials', status_code: 401 },
          { status: 401 },
        );
      }

      isAuthenticated = true;
      return HttpResponse.json({
        access: MOCK_ACCESS_TOKEN,
        user: MOCK_USER,
      });
    }),

    // POST /auth/refresh → 200 RefreshRes (matches M10)
    http.post(`${baseUrl}${API_PREFIX}/auth/refresh`, () => {
      if (!isAuthenticated) {
        return HttpResponse.json(
          { error: 'Unauthorized', message: 'Missing or invalid refresh token', status_code: 401 },
          { status: 401 },
        );
      }
      return HttpResponse.json({ access: MOCK_ACCESS_TOKEN });
    }),

    // POST /auth/logout → 204 (matches M10)
    http.post(`${baseUrl}${API_PREFIX}/auth/logout`, () => {
      isAuthenticated = false;
      return new HttpResponse(null, { status: 204 });
    }),

    // GET /auth/me → 200 UserSchema (matches M10)
    http.get(`${baseUrl}${API_PREFIX}/auth/me`, ({ request }) => {
      const auth = request.headers.get('authorization');
      if (!auth?.startsWith('Bearer ') || !isAuthenticated) {
        return HttpResponse.json(
          { error: 'Unauthorized', message: 'Missing bearer token', status_code: 401 },
          { status: 401 },
        );
      }
      return HttpResponse.json(MOCK_USER);
    }),
  ];
}

// Default handlers use the VITE_API_URL from the environment
export const handlers = createHandlers(
  typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_URL ?? '' : '',
);
