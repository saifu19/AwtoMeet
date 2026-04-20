import { useEffect, useRef } from 'react';
import type { TranscriptMessageSchema } from '@meeting-app/shared';
import { formatTime } from '@/lib/utils';

interface TranscriptColumnProps {
  messages: TranscriptMessageSchema[];
}

const STICKY_THRESHOLD_PX = 100;

// Consistent color per speaker — cycles through a palette of distinct hues.
const SPEAKER_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-fuchsia-500',
  'bg-lime-500',
];

const speakerColorMap = new Map<string, string>();

function getSpeakerColor(identity: string): string {
  if (!speakerColorMap.has(identity)) {
    speakerColorMap.set(
      identity,
      SPEAKER_COLORS[speakerColorMap.size % SPEAKER_COLORS.length]!,
    );
  }
  return speakerColorMap.get(identity)!;
}

// Auto-scrolls to bottom on new messages ONLY if the user is already within
// STICKY_THRESHOLD_PX of the bottom. If they scrolled up to read, the view
// is left alone.
export function TranscriptColumn({ messages }: TranscriptColumnProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    wasAtBottomRef.current = distanceFromBottom < STICKY_THRESHOLD_PX;
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="mx-auto h-8 w-8 rounded-full bg-muted flex items-center justify-center">
            <svg className="h-4 w-4 text-muted-foreground animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <p className="text-sm text-muted-foreground">
            Waiting for the first words...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto px-4 py-3 space-y-1"
    >
      {messages.map((m) => (
        <div
          key={m.id}
          className="group flex gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50"
        >
          {/* Speaker color dot */}
          <div className="mt-1.5 flex-shrink-0">
            <div className={`h-2 w-2 rounded-full ${getSpeakerColor(m.speaker_identity)}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-foreground">
                {m.speaker_name}
              </span>
              <time className="text-[10px] font-mono text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                {formatTime(m.created_at)}
              </time>
            </div>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {m.text}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
