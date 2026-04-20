import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useMe } from '../useMe';
import { setAccessToken } from '@/lib/auth-store';
import { API_PREFIX } from '@/lib/api';
import React from 'react';

const API_URL = 'http://localhost:3001';

const MOCK_USER = {
  id: '01JA0000000000000000000001',
  email: 'test@example.com',
  display_name: 'Test User',
  is_superadmin: false,
  created_at: '2025-01-01T00:00:00.000Z',
};

const server = setupServer(
  http.get(`${API_URL}${API_PREFIX}/auth/me`, ({ request }) => {
    const auth = request.headers.get('authorization');
    if (!auth) return new HttpResponse(null, { status: 401 });
    return HttpResponse.json(MOCK_USER);
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  setAccessToken(null);
});
afterAll(() => server.close());

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('useMe', () => {
  it('returns user data when authenticated', async () => {
    setAccessToken('valid-token');
    const { result } = renderHook(() => useMe(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(MOCK_USER);
  });

  it('returns error when not authenticated', async () => {
    server.use(
      http.get(`${API_URL}${API_PREFIX}/auth/me`, () => {
        return new HttpResponse(null, { status: 401 });
      }),
      http.post(`${API_URL}${API_PREFIX}/auth/refresh`, () => {
        return new HttpResponse(null, { status: 401 });
      }),
    );

    const { result } = renderHook(() => useMe(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
