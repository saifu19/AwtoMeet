import { useEffect, useState, useCallback } from 'react';
import { RoomEvent } from 'livekit-client';
import type {
  RemoteParticipant,
  DataPacket_Kind,
} from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';
import {
  CAPTION_TOPIC,
  CaptionPayloadSchema,
  type CaptionPayload,
} from '@meeting-app/shared';

// M34: low-latency caption overlay. Subscribes to data-channel messages on
// topic "transcript" (published by the worker per apps/worker/src/captions.py)
// and shows the last few as a fading overlay at the bottom of the room page.
//
// This path is fire-and-forget — M31 owns the authoritative DB transcript and
// M33 owns the SSE feed. If a message is dropped here, the dashboard still has
// it. Never persist from the browser.

const MAX_VISIBLE = 3;
const CAPTION_TTL_MS = 8000;

interface DisplayCaption {
  id: string;
  speaker_name: string;
  text: string;
}

// Strip ULID-shaped identities ("user_01ARZ...", "guest-01ARZ...") down to
// something humane when the participant never set a display name.
function prettifySpeaker(name: string): string {
  if (/^user_[0-9A-HJKMNP-TV-Z]{26}$/i.test(name)) return 'Participant';
  if (/^guest-[0-9A-HJKMNP-TV-Z]{26}$/i.test(name)) return 'Guest';
  return name;
}

function parseCaption(payload: Uint8Array): CaptionPayload | null {
  let text: string;
  try {
    text = new TextDecoder().decode(payload);
  } catch {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const result = CaptionPayloadSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function LiveCaptions() {
  const room = useRoomContext();
  const [captions, setCaptions] = useState<DisplayCaption[]>([]);

  const removeCaption = useCallback((id: string) => {
    setCaptions((prev) => prev.filter((c) => c.id !== id));
  }, []);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const handler = (
      payload: Uint8Array,
      _participant?: RemoteParticipant,
      _kind?: DataPacket_Kind,
      topic?: string,
    ) => {
      if (topic !== CAPTION_TOPIC) return;
      const parsed = parseCaption(payload);
      if (!parsed) return;

      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;

      const caption: DisplayCaption = {
        id,
        speaker_name: prettifySpeaker(parsed.speaker_name),
        text: parsed.text,
      };

      setCaptions((prev) => [...prev, caption].slice(-MAX_VISIBLE));

      const timer = setTimeout(() => {
        removeCaption(id);
        timers.delete(timer);
      }, CAPTION_TTL_MS);
      timers.add(timer);
    };

    room.on(RoomEvent.DataReceived, handler);

    return () => {
      room.off(RoomEvent.DataReceived, handler);
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, [room, removeCaption]);

  if (captions.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-24 left-1/2 z-50 flex w-full max-w-2xl -translate-x-1/2 flex-col items-center gap-1 px-4"
      data-testid="live-captions"
    >
      {captions.map((c) => (
        <div
          key={c.id}
          className="glass rounded-xl px-3 py-1.5 text-sm text-foreground shadow-lg transition-opacity"
        >
          <span className="mr-2 opacity-70">{c.speaker_name}:</span>
          <span>{c.text}</span>
        </div>
      ))}
    </div>
  );
}
