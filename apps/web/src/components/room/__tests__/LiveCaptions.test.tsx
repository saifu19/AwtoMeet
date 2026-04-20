import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { RoomEvent } from 'livekit-client';
import { LiveCaptions } from '../LiveCaptions';

// Fake Room that records listeners and lets tests synthesize DataReceived events.
class FakeRoom {
  private listeners = new Map<string, Set<Function>>();

  on(event: string, cb: Function) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb);
    this.listeners.set(event, set);
    return this;
  }

  off(event: string, cb: Function) {
    this.listeners.get(event)?.delete(cb);
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((cb) => cb(...args));
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

let fakeRoom: FakeRoom;

vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => fakeRoom,
}));

function encode(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

const validPayload = {
  speaker_identity: 'user_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  speaker_name: 'Alice',
  text: 'hello world',
  start_ts_ms: 1_700_000_000_000,
  end_ts_ms: 1_700_000_001_000,
};

beforeEach(() => {
  fakeRoom = new FakeRoom();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('LiveCaptions', () => {
  it('renders a caption from a valid transcript data message', () => {
    render(<LiveCaptions />);

    act(() => {
      fakeRoom.emit(
        RoomEvent.DataReceived,
        encode(validPayload),
        undefined,
        undefined,
        'transcript',
      );
    });

    expect(screen.getByText('hello world')).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it('ignores messages with a different topic', () => {
    render(<LiveCaptions />);

    act(() => {
      fakeRoom.emit(
        RoomEvent.DataReceived,
        encode(validPayload),
        undefined,
        undefined,
        'hot_reload',
      );
    });

    expect(screen.queryByTestId('live-captions')).toBeNull();
  });

  it('ignores malformed JSON without crashing', () => {
    render(<LiveCaptions />);

    act(() => {
      fakeRoom.emit(
        RoomEvent.DataReceived,
        new TextEncoder().encode('{not json'),
        undefined,
        undefined,
        'transcript',
      );
    });

    expect(screen.queryByTestId('live-captions')).toBeNull();
  });

  it('drops payloads that fail schema validation', () => {
    render(<LiveCaptions />);

    act(() => {
      fakeRoom.emit(
        RoomEvent.DataReceived,
        encode({ speaker_name: 'Alice' }), // missing required fields
        undefined,
        undefined,
        'transcript',
      );
    });

    expect(screen.queryByTestId('live-captions')).toBeNull();
  });

  it('caps visible captions at 3', () => {
    render(<LiveCaptions />);

    act(() => {
      for (let i = 0; i < 5; i++) {
        fakeRoom.emit(
          RoomEvent.DataReceived,
          encode({ ...validPayload, text: `line ${i}` }),
          undefined,
          undefined,
          'transcript',
        );
      }
    });

    expect(screen.queryByText('line 0')).toBeNull();
    expect(screen.queryByText('line 1')).toBeNull();
    expect(screen.getByText('line 2')).toBeInTheDocument();
    expect(screen.getByText('line 3')).toBeInTheDocument();
    expect(screen.getByText('line 4')).toBeInTheDocument();
  });

  it('fades a caption after 8 seconds', () => {
    render(<LiveCaptions />);

    act(() => {
      fakeRoom.emit(
        RoomEvent.DataReceived,
        encode(validPayload),
        undefined,
        undefined,
        'transcript',
      );
    });

    expect(screen.getByText('hello world')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(8001);
    });

    expect(screen.queryByText('hello world')).toBeNull();
  });

  it('prettifies ULID-shaped speaker names', () => {
    render(<LiveCaptions />);

    act(() => {
      fakeRoom.emit(
        RoomEvent.DataReceived,
        encode({
          ...validPayload,
          // When participant.name was empty the worker falls back to identity
          speaker_name: 'user_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        }),
        undefined,
        undefined,
        'transcript',
      );
    });

    expect(screen.getByText(/Participant/)).toBeInTheDocument();
  });

  it('prettifies guest ULID identities', () => {
    render(<LiveCaptions />);

    act(() => {
      fakeRoom.emit(
        RoomEvent.DataReceived,
        encode({
          ...validPayload,
          speaker_name: 'guest-01ARZ3NDEKTSV4RRFFQ69G5FAV',
        }),
        undefined,
        undefined,
        'transcript',
      );
    });

    expect(screen.getByText(/Guest/)).toBeInTheDocument();
  });

  it('unsubscribes from DataReceived on unmount', () => {
    const { unmount } = render(<LiveCaptions />);
    expect(fakeRoom.listenerCount(RoomEvent.DataReceived)).toBe(1);
    unmount();
    expect(fakeRoom.listenerCount(RoomEvent.DataReceived)).toBe(0);
  });
});
