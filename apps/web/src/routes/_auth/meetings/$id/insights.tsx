import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeftIcon, MicIcon, SparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useMeeting } from '@/features/meetings/hooks';
import { useMeetingStream, type StreamStatus } from '@/hooks/useMeetingStream';
import { TranscriptColumn } from '@/components/insights/TranscriptColumn';
import { InsightsColumn } from '@/components/insights/InsightsColumn';

export const Route = createFileRoute('/_auth/meetings/$id/insights')({
  component: InsightsDashboardPage,
});

const statusLabel: Record<StreamStatus, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  error: 'Error',
  closed: 'Closed',
};

const statusColor: Record<StreamStatus, string> = {
  connecting: 'glass text-foreground',
  live: 'glass neon-ring-accent text-[var(--neon-accent)]',
  reconnecting: 'glass text-amber-600 dark:text-amber-400',
  error: 'glass text-destructive',
  closed: 'bg-muted text-muted-foreground border border-border',
};

function StatusPill({ status }: { status: StreamStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${statusColor[status]}`}
    >
      {status === 'live' && (
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--neon-accent)] shadow-[0_0_8px_var(--neon-accent)] animate-pulse" />
      )}
      {statusLabel[status]}
    </span>
  );
}

function AccessDenied({ meetingId }: { meetingId: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card variant="glass" className="max-w-md shadow-lg">
        <CardContent className="py-8 text-center space-y-4">
          <h2 className="text-lg font-semibold">Access denied</h2>
          <p className="text-sm text-muted-foreground">
            You don't have permission to view insights for this meeting. Ask the
            host to grant you the "View insights" permission on your invite.
          </p>
          <Link to="/meetings/$id" params={{ id: meetingId }}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <ArrowLeftIcon className="h-4 w-4" />
              Back to meeting
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function InsightsDashboardPage() {
  const { id } = Route.useParams();
  const { data: meeting } = useMeeting(id);
  const { transcript, insights, status, error } = useMeetingStream(id);

  if (error === 'access_denied') {
    return <AccessDenied meetingId={id} />;
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/meetings/$id" params={{ id }}>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">
              {meeting?.title ?? 'Live insights'}
            </h1>
            <p className="text-[11px] text-muted-foreground">
              Live dashboard
            </p>
          </div>
        </div>
        <StatusPill status={status} />
      </header>

      {/* Two-column grid */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-border">
        <section className="min-h-0 flex flex-col bg-card">
          <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center gap-2">
            <MicIcon className="h-3.5 w-3.5 text-[var(--neon-accent)]" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Live transcript
            </h2>
            {transcript.length > 0 && (
              <span className="ml-auto text-[10px] font-mono text-muted-foreground/60">
                {transcript.length} messages
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0">
            <TranscriptColumn messages={transcript} />
          </div>
        </section>
        <section className="min-h-0 flex flex-col glass">
          <div className="px-4 py-2.5 border-b border-border bg-[var(--neon)]/5 flex items-center gap-2">
            <SparklesIcon className="h-3.5 w-3.5 text-[var(--neon)]" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Agent insights
            </h2>
            {insights.length > 0 && (
              <span className="ml-auto text-[10px] font-mono text-muted-foreground/60">
                {insights.length} insights
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0">
            <InsightsColumn meetingId={id} outputs={insights} />
          </div>
        </section>
      </div>
    </div>
  );
}
