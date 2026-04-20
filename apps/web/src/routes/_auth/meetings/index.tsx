import { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
  PlusIcon,
  Trash2Icon,
  SparklesIcon,
  ClockIcon,
  VideoIcon,
} from 'lucide-react';
import type { MeetingSchema } from '@meeting-app/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MeetingCardActions } from '@/components/meetings/MeetingCardActions';
import { useMeetings, useDeleteMeeting } from '@/features/meetings/hooks';
import { ApiError } from '@/lib/api';

export const Route = createFileRoute('/_auth/meetings/')({
  component: MeetingsListPage,
});

function formatDate(iso: string | null) {
  if (!iso) return 'Not scheduled';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusBadge(status: string) {
  switch (status) {
    case 'scheduled':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
    case 'live':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
    case 'summarizing':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    case 'ended':
      return 'bg-muted text-muted-foreground';
    case 'cancelled':
      return 'bg-red-500/10 text-red-600 dark:text-red-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function statusLabel(status: string) {
  if (status === 'summarizing') return 'Generating Summary...';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/* ── Skeleton card ─────────────────────────────────────────── */
function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-5 animate-pulse">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-9 w-9 rounded-lg bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted" />
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <div className="h-5 w-20 rounded-full bg-muted" />
      </div>
      <div className="h-3 w-28 rounded bg-muted mt-4" />
    </div>
  );
}

/* ── Meeting card ──────────────────────────────────────────── */
function MeetingCard({
  meeting,
  onDelete,
}: {
  meeting: MeetingSchema;
  onDelete: (meeting: MeetingSchema) => void;
}) {
  const navigate = useNavigate();

  const openDetail = () => {
    void navigate({ to: '/meetings/$id', params: { id: meeting.id } });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openDetail();
    }
  };

  return (
    <Card
      role="link"
      tabIndex={0}
      onClick={openDetail}
      onKeyDown={onKeyDown}
      className="group relative overflow-hidden transition-all duration-200 hover:shadow-[0_0_24px_-4px_oklch(from_var(--neon)_l_c_h/50%)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Neon top accent */}
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[var(--neon)] to-[var(--neon-accent)] opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

      {/* Hover actions — only Delete now (Edit is redundant since the whole
          card opens the detail page). Delete stops propagation so clicking
          the trash icon doesn't also navigate. */}
      {meeting.status !== 'live' && (
        <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <Button
            variant="ghost"
            size="icon-xs"
            className="h-7 w-7 hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(meeting);
            }}
          >
            <Trash2Icon className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <CardHeader className="pb-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--neon)]/10">
            <VideoIcon className="h-4 w-4 text-[var(--neon)]" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-sm truncate">{meeting.title}</CardTitle>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {meeting.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-4">
            {meeting.description}
          </p>
        )}
        {!meeting.description && <div className="mb-4" />}

        {/* Status badge */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadge(meeting.status)}`}
          >
            {meeting.status === 'live' && (
              <span className="mr-1 h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            )}
            {meeting.status === 'summarizing' && (
              <span className="mr-1 h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
            )}
            {statusLabel(meeting.status)}
          </span>
        </div>

        {/* Date */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-3">
          <ClockIcon className="h-3 w-3" />
          {(meeting.status === 'ended' || meeting.status === 'summarizing') && meeting.ended_at
            ? `Ended ${formatDate(meeting.ended_at)}`
            : formatDate(meeting.scheduled_at)}
        </div>

        {/* Action buttons */}
        <MeetingCardActions
          meetingId={meeting.id}
          status={meeting.status}
          compact
        />
      </CardContent>
    </Card>
  );
}

/* ── Page ────────────────────────────────────────────────────── */
function MeetingsListPage() {
  const { data: meetings, isLoading } = useMeetings();
  const deleteMeeting = useDeleteMeeting();
  const [deleteTarget, setDeleteTarget] = useState<MeetingSchema | null>(null);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMeeting.mutateAsync(deleteTarget.id);
      toast.success(`"${deleteTarget.title}" has been deleted`);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.body?.message ?? err.message
          : 'Failed to delete meeting';
      toast.error(message);
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-heading text-4xl leading-none tracking-tight">Meetings</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Schedule and manage your meetings
          </p>
        </div>
        <Link to="/meetings/new">
          <Button variant="neon">
            <PlusIcon className="mr-2 h-4 w-4" />
            New Meeting
          </Button>
        </Link>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (!meetings || meetings.length === 0) && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="glass neon-ring flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--neon)]/15 mb-5">
              <SparklesIcon className="h-8 w-8 text-[var(--neon)]" />
            </div>
            <CardTitle display className="mb-2">No meetings yet</CardTitle>
            <CardDescription className="text-center max-w-sm mb-6">
              Schedule your first meeting to start getting AI-powered insights.
            </CardDescription>
            <Link to="/meetings/new">
              <Button variant="neon">
                <PlusIcon className="mr-2 h-4 w-4" />
                Schedule your first meeting
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Meeting card grid */}
      {!isLoading && meetings && meetings.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {meetings.map((meeting) => (
            <MeetingCard
              key={meeting.id}
              meeting={meeting}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete meeting</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-medium text-foreground">
                &quot;{deleteTarget?.title}&quot;
              </span>
              ? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMeeting.isPending}
            >
              {deleteMeeting.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
