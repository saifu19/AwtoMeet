import { Link } from '@tanstack/react-router';
import {
  SparklesIcon,
  FileTextIcon,
  Loader2Icon,
  VideoIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MeetingCardActionsProps {
  meetingId: string;
  status: string;
  /** Whether the current viewer has permission to view insights/summary.
   *  Defaults to true (safe for owner context). Pass false to hide
   *  insights/summary buttons for invitees without the permission. */
  canViewInsights?: boolean;
  /** Uses xs-sized buttons for card grid contexts. */
  compact?: boolean;
}

/**
 * Renders context-appropriate action buttons for a meeting based on its status.
 *
 * - scheduled / live  → Join
 * - ended             → Open Insights + View Summary
 * - summarizing       → Open Insights + Generating Summary... (disabled)
 * - cancelled         → (nothing)
 */
export function MeetingCardActions({
  meetingId,
  status,
  canViewInsights = true,
  compact = false,
}: MeetingCardActionsProps) {
  if (status === 'cancelled') return null;

  const btnSize = compact ? 'xs' : 'sm';

  // ── Scheduled / Live → Join ───────────────────────────────────────
  if (status === 'scheduled' || status === 'live') {
    return (
      <Link
        to="/meetings/$id/room"
        params={{ id: meetingId }}
        onClick={(e) => e.stopPropagation()}
      >
        <Button size={btnSize} variant="neon">
          <VideoIcon />
          Join
        </Button>
      </Link>
    );
  }

  // ── Ended / Summarizing → Insights + Summary ─────────────────────
  if (status === 'ended' || status === 'summarizing') {
    return (
      <div
        className="flex items-center gap-1.5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {canViewInsights && (
          <>
            <Button
              variant="outline"
              size={btnSize}
              title="Open Insights"
              onClick={(e) => {
                e.stopPropagation();
                window.open(
                  `/meetings/${meetingId}/insights`,
                  '_blank',
                  'noopener',
                );
              }}
            >
              <SparklesIcon />
              Insights
            </Button>

            {status === 'ended' && (
              <Link to="/meetings/$id/summary" params={{ id: meetingId }}>
                <Button variant="outline" size={btnSize} title="View Summary">
                  <FileTextIcon />
                  Summary
                </Button>
              </Link>
            )}

            {status === 'summarizing' && (
              <Button variant="outline" size={btnSize} disabled>
                <Loader2Icon className="animate-spin" />
                Summarizing...
              </Button>
            )}
          </>
        )}
      </div>
    );
  }

  return null;
}
