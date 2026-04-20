import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createElement } from 'react';
import { API_PREFIX } from '@/lib/api';
import { useAgents, useCreateAgent } from '../hooks';

const API_URL = 'http://localhost:3001';

const MOCK_AGENT = {
  id: '01AAAAAAAAAAAAAAAAAAAAAAAA',
  user_id: '01BBBBBBBBBBBBBBBBBBBBBBBB',
  org_id: null,
  name: 'Test Agent',
  system_prompt: 'You are a test agent.',
  provider: 'openai',
  model: 'gpt-4o-mini',
  created_at: '2026-01-01T00:00:00.000Z',
};

const server = setupServer(
  http.get(`${API_URL}${API_PREFIX}/agents`, () =>
    HttpResponse.json({ data: [MOCK_AGENT] }),
  ),
  http.post(`${API_URL}${API_PREFIX}/agents`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      {
        ...MOCK_AGENT,
        name: body.name ?? MOCK_AGENT.name,
        system_prompt: body.system_prompt ?? MOCK_AGENT.system_prompt,
      },
      { status: 201 },
    );
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useAgents', () => {
  it('fetches and returns agent list', async () => {
    const { result } = renderHook(() => useAgents(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.name).toBe('Test Agent');
  });
});

describe('useCreateAgent', () => {
  it('posts new agent and returns result', async () => {
    const { result } = renderHook(() => useCreateAgent(), {
      wrapper: createWrapper(),
    });

    const promise = result.current.mutateAsync({
      name: 'New Agent',
      system_prompt: 'Does new things.',
    });

    await waitFor(async () => {
      const created = await promise;
      expect(created.name).toBe('New Agent');
    });
  });
});
