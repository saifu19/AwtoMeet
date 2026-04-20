import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  vi,
} from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useMeetingStream } from '../useMeetingStream';
import { setAccessToken } from '@/lib/auth-store';
import { API_PREFIX } from '@/lib/api';

const API_URL = 'http://localhost:3001';
const MEETING_ID = '01JA0000000000000000000001';

type EsInstance = MockEventSource;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  withCredentials: boolean;
  readyState: number = 0;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  listeners = new Map<string, Array<(ev: MessageEvent) => void>>();
  closed = false;

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (ev: MessageEvent) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }

  removeEventListener(type: string, cb: (ev: MessageEvent) => void) {
    const arr = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      arr.filter((x) => x !== cb),
    );
  }

  emit(type: string, data: unknown) {
    const arr = this.listeners.get(type) ?? [];
    for (const cb of arr) {
      cb(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }

  triggerError() {
    this.onerror?.(new Event('error'));
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

const server = setupServer(
  http.get(`${API_URL}${API_PREFIX}/meetings/${MEETING_ID}/transcript`, () =>
    HttpResponse.json({
      messages: [
        {
          id: 1,
          meeting_id: MEETING_ID,
          speaker_identity: 'speaker-a',
          speaker_name: 'Alice',
          text: 'first',
          start_ts_ms: 0,
          end_ts_ms: 500,
          created_at: '2026-04-11T12:00:00.000Z',
        },
      ],
    }),
  ),
  http.get(`${API_URL}${API_PREFIX}/meetings/${MEETING_ID}/insights`, () =>
    HttpResponse.json({ insights: [] }),
  ),
  http.post(
    `${API_URL}${API_PREFIX}/meetings/${MEETING_ID}/stream-session`,
    () => new HttpResponse(null, { status: 204 }),
  ),
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  // @ts-expect-error replace global EventSource for jsdom
  globalThis.EventSource = MockEventSource;
});

beforeEach(() => {
  MockEventSource.instances = [];
  setAccessToken('valid-token');
});

afterEach(() => {
  server.resetHandlers();
  setAccessToken(null);
});

afterAll(() => server.close());

function getLatestES(): EsInstance {
  const es = MockEventSource.instances[MockEventSource.instances.length - 1];
  if (!es) throw new Error('no EventSource created yet');
  return es;
}

describe('useMeetingStream', () => {
  it('hydrates snapshots and seeds transcript', async () => {
    const { result } = renderHook(() => useMeetingStream(MEETING_ID));

    await waitFor(() => expect(result.current.transcript).toHaveLength(1));
    expect(result.current.transcript[0]!.text).toBe('first');
    expect(result.current.insights).toEqual([]);
  });

  it('appends transcript events from the stream and flips status to live', async () => {
    const { result } = renderHook(() => useMeetingStream(MEETING_ID));

    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = getLatestES();

    act(() => {
      es.emit('transcript', {
        type: 'transcript',
        data: {
          id: 2,
          meeting_id: MEETING_ID,
          speaker_identity: 'speaker-b',
          speaker_name: 'Bob',
          text: 'second',
          start_ts_ms: 600,
          end_ts_ms: 1200,
          created_at: '2026-04-11T12:00:01.000Z',
        },
      });
    });

    await waitFor(() => expect(result.current.transcript).toHaveLength(2));
    expect(result.current.transcript[1]!.text).toBe('second');
    expect(result.current.status).toBe('live');
  });

  it('flips to live on a ping event', async () => {
    const { result } = renderHook(() => useMeetingStream(MEETING_ID));

    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = getLatestES();
    act(() => es.emit('ping', {}));
    await waitFor(() => expect(result.current.status).toBe('live'));
  });

  it('reports access_denied when snapshot fetch returns 404', async () => {
    server.use(
      http.get(
        `${API_URL}${API_PREFIX}/meetings/${MEETING_ID}/transcript`,
        () =>
          HttpResponse.json(
            { error: 'Not Found', message: 'not_found', status_code: 404 },
            { status: 404 },
          ),
      ),
      http.post(`${API_URL}${API_PREFIX}/auth/refresh`, () =>
        HttpResponse.json(
          { error: 'Unauthorized', message: 'nope', status_code: 401 },
          { status: 401 },
        ),
      ),
    );

    const { result } = renderHook(() => useMeetingStream(MEETING_ID));
    await waitFor(() => expect(result.current.error).toBe('access_denied'));
    expect(result.current.status).toBe('error');
  });

  it('closes the EventSource on unmount', async () => {
    const { unmount } = renderHook(() => useMeetingStream(MEETING_ID));
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = getLatestES();
    unmount();
    expect(es.closed).toBe(true);
  });

  it('enters reconnecting state on transient EventSource error', async () => {
    const { result } = renderHook(() => useMeetingStream(MEETING_ID));
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const first = getLatestES();
    act(() => first.triggerError());
    expect(first.closed).toBe(true);
    await waitFor(() => expect(result.current.status).toBe('reconnecting'));
  });
});
