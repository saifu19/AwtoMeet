import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCreateDispatch = vi.fn();
vi.mock('livekit-server-sdk', () => ({
  AgentDispatchClient: class {
    createDispatch = mockCreateDispatch;
  },
}));

import { dispatchMeetingWorker } from '../dispatch.js';

const SAVED_ENV = { ...process.env };

beforeEach(() => {
  process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';
  process.env.LIVEKIT_API_KEY = 'test-key';
  process.env.LIVEKIT_API_SECRET = 'test-secret';
  mockCreateDispatch.mockReset();
});

afterEach(() => {
  process.env = { ...SAVED_ENV };
});

describe('dispatchMeetingWorker', () => {
  it('calls createDispatch with correct args and returns dispatch id', async () => {
    mockCreateDispatch.mockResolvedValue({ id: 'dispatch-123' });

    const result = await dispatchMeetingWorker({
      meetingId: 'abc123',
      roomName: 'meeting-abc123',
    });

    expect(result).toBe('dispatch-123');
    expect(mockCreateDispatch).toHaveBeenCalledWith(
      'meeting-abc123',
      'meet-transcriber',
      { metadata: '{"meeting_id":"abc123"}' },
    );
  });

  it('swallows already-exists error (code) and returns null', async () => {
    mockCreateDispatch.mockRejectedValue(
      Object.assign(new Error('dispatch already exists'), {
        code: 'already_exists',
      }),
    );

    const result = await dispatchMeetingWorker({
      meetingId: 'abc123',
      roomName: 'meeting-abc123',
    });

    expect(result).toBeNull();
  });

  it('swallows already-exists error (message fallback) and returns null', async () => {
    mockCreateDispatch.mockRejectedValue(
      new Error('Agent dispatch already exists for this room'),
    );

    const result = await dispatchMeetingWorker({
      meetingId: 'abc123',
      roomName: 'meeting-abc123',
    });

    expect(result).toBeNull();
  });

  it('propagates other errors', async () => {
    mockCreateDispatch.mockRejectedValue(new Error('connection refused'));

    await expect(
      dispatchMeetingWorker({
        meetingId: 'abc123',
        roomName: 'meeting-abc123',
      }),
    ).rejects.toThrow('connection refused');
  });

  it('throws when env vars are missing', async () => {
    delete process.env.LIVEKIT_URL;

    await expect(
      dispatchMeetingWorker({
        meetingId: 'abc123',
        roomName: 'meeting-abc123',
      }),
    ).rejects.toThrow('LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET must be set');
  });
});
