import { useEffect, useRef, useState } from 'react';
import type {
  TranscriptMessageSchema,
  AgentOutputSchema,
} from '@meeting-app/shared';
import { api, API_PREFIX, ApiError } from '@/lib/api';

export type StreamStatus =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'error'
  | 'closed';

export interface UseMeetingStreamResult {
  transcript: TranscriptMessageSchema[];
  insights: AgentOutputSchema[];
  status: StreamStatus;
  error: 'access_denied' | 'unknown' | null;
}

interface TranscriptSnapshot {
  messages: TranscriptMessageSchema[];
}
interface InsightsSnapshot {
  insights: AgentOutputSchema[];
}

const API_URL = import.meta.env.VITE_API_URL ?? '';
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 1;

function buildStreamUrl(
  meetingId: string,
  lastTranscriptId: number,
  lastInsightId: number,
): string {
  const qs = new URLSearchParams({
    last_transcript_id: String(lastTranscriptId),
    last_insight_id: String(lastInsightId),
  });
  return `${API_URL}${API_PREFIX}/meetings/${meetingId}/stream?${qs.toString()}`;
}

// Hydrates snapshots, mints a short-lived stream_session cookie, then opens a
// native EventSource. Validation happens exactly once at handshake (via the
// API's requireStreamAuth preHandler); the cookie is dead after 60s so any
// reconnect goes through a fresh mint. We disable EventSource's native
// auto-reconnect because it would retry with the dead cookie forever.
export function useMeetingStream(
  meetingId: string,
): UseMeetingStreamResult {
  const [transcript, setTranscript] = useState<TranscriptMessageSchema[]>([]);
  const [insights, setInsights] = useState<AgentOutputSchema[]>([]);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [error, setError] = useState<UseMeetingStreamResult['error']>(null);

  const lastTranscriptId = useRef(0);
  const lastInsightId = useRef(0);

  useEffect(() => {
    // Reset state when the meetingId changes so a stale transcript from a
    // previous meeting never bleeds through.
    setTranscript([]);
    setInsights([]);
    setStatus('connecting');
    setError(null);
    lastTranscriptId.current = 0;
    lastInsightId.current = 0;

    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function handleTranscriptEvent(ev: MessageEvent) {
      try {
        const parsed = JSON.parse(ev.data) as {
          type: 'transcript';
          data: TranscriptMessageSchema;
        };
        lastTranscriptId.current = Math.max(
          lastTranscriptId.current,
          parsed.data.id,
        );
        setTranscript((prev) => [...prev, parsed.data]);
        setStatus('live');
      } catch {
        // ignore malformed frame
      }
    }

    function handleInsightEvent(ev: MessageEvent) {
      try {
        const parsed = JSON.parse(ev.data) as {
          type: 'insight';
          data: AgentOutputSchema;
        };
        lastInsightId.current = Math.max(
          lastInsightId.current,
          parsed.data.id,
        );
        setInsights((prev) => [...prev, parsed.data]);
        setStatus('live');
      } catch {
        // ignore malformed frame
      }
    }

    function handlePingEvent() {
      setStatus('live');
    }

    async function openStream() {
      if (cancelled) return;
      await api<void>(`/meetings/${meetingId}/stream-session`, {
        method: 'POST',
      });
      if (cancelled) return;

      const url = buildStreamUrl(
        meetingId,
        lastTranscriptId.current,
        lastInsightId.current,
      );
      const nextEs = new EventSource(url, { withCredentials: true });
      es = nextEs;

      nextEs.addEventListener('transcript', handleTranscriptEvent);
      nextEs.addEventListener('insight', handleInsightEvent);
      nextEs.addEventListener('ping', handlePingEvent);

      nextEs.onerror = () => {
        if (cancelled) return;
        // Disable native auto-reconnect: the 60s cookie is likely dead and
        // the browser would otherwise hammer the server forever.
        nextEs.close();
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          setStatus('closed');
          return;
        }
        reconnectAttempts += 1;
        setStatus('reconnecting');
        reconnectTimer = setTimeout(() => {
          void openStream().catch(handleFatal);
        }, RECONNECT_DELAY_MS);
      };
    }

    function handleFatal(err: unknown) {
      if (cancelled) return;
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        setError('access_denied');
      } else {
        setError('unknown');
      }
      setStatus('error');
    }

    async function bootstrap() {
      try {
        const [snapT, snapI] = await Promise.all([
          api<TranscriptSnapshot>(`/meetings/${meetingId}/transcript`),
          api<InsightsSnapshot>(`/meetings/${meetingId}/insights`),
        ]);
        if (cancelled) return;

        lastTranscriptId.current = snapT.messages.reduce(
          (acc, m) => Math.max(acc, m.id),
          0,
        );
        lastInsightId.current = snapI.insights.reduce(
          (acc, i) => Math.max(acc, i.id),
          0,
        );
        setTranscript(snapT.messages);
        setInsights(snapI.insights);

        await openStream();
      } catch (err) {
        handleFatal(err);
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [meetingId]);

  return { transcript, insights, status, error };
}
