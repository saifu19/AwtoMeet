import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ArrowLeftIcon, VideoIcon } from 'lucide-react';
import type { CreateMeetingReq, UpdateMeetingReq } from '@meeting-app/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { MeetingCardActions } from '@/components/meetings/MeetingCardActions';
import { MeetingForm } from '@/features/meetings/MeetingForm';
import { InviteManager } from '@/features/meetings/InviteManager';
import { useMeeting, useUpdateMeeting } from '@/features/meetings/hooks';
import { useMe } from '@/hooks/useMe';
import { ApiError } from '@/lib/api';

export const Route = createFileRoute('/_auth/meetings/$id/')({
  component: MeetingDetailPage,
});

function statusBadgeVariant(status: string) {
  switch (status) {
    case 'scheduled':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800';
    case 'live':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
    case 'summarizing':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800';
    case 'ended':
      return 'bg-muted text-muted-foreground border-border';
    case 'cancelled':
      return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function statusDisplayLabel(status: string) {
  if (status === 'summarizing') return 'Generating Summary...';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function MeetingDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data: meeting, isLoading } = useMeeting(id);
  const { data: currentUser } = useMe();
  const updateMeeting = useUpdateMeeting();

  const handleSubmit = async (data: CreateMeetingReq) => {
    try {
      const updateData: UpdateMeetingReq = {
        title: data.title,
        description: data.description,
        scheduled_at: data.scheduled_at,
        meeting_type_id: data.meeting_type_id ?? null,
        auto_classify: data.auto_classify,
      };
      const updated = await updateMeeting.mutateAsync({ id, data: updateData });
      toast.success(`Meeting "${updated.title}" updated successfully`);
      navigate({ to: '/meetings' });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.body?.message ?? err.message
          : 'Failed to update meeting';
      toast.error(message);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl p-6 lg:p-8">
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="mx-auto max-w-5xl p-6 lg:p-8">
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-muted-foreground mb-4">Meeting not found</p>
          <Link to="/meetings">
            <Button variant="outline">Back to meetings</Button>
          </Link>
        </div>
      </div>
    );
  }

  const isEditable = meeting.status === 'scheduled';
  const isJoinable = meeting.status === 'scheduled' || meeting.status === 'live';

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <Link to="/meetings">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground mb-6"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to meetings
        </Button>
      </Link>

      {/* Meeting header with status + join */}
      <Card variant="glass" className="mb-8 shadow-lg">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--neon)]/10">
                <VideoIcon className="h-5 w-5 text-[var(--neon)]" />
              </div>
              <div>
                <CardTitle className="text-xl">{meeting.title}</CardTitle>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadgeVariant(meeting.status)}`}
                  >
                    {meeting.status === 'live' && (
                      <span className="mr-1 h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    )}
                    {meeting.status === 'summarizing' && (
                      <span className="mr-1 h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                    )}
                    {statusDisplayLabel(meeting.status)}
                  </span>
                  {meeting.scheduled_at && (
                    <span className="text-xs text-muted-foreground">
                      {formatDate(meeting.scheduled_at)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!isJoinable && (
                <MeetingCardActions
                  meetingId={id}
                  status={meeting.status}
                  canViewInsights={meeting.viewer_can_view_insights === true}
                />
              )}
              {isJoinable ? (
                <Link to="/meetings/$id/room" params={{ id }}>
                  <Button variant="neon">
                    <VideoIcon className="mr-2 h-4 w-4" />
                    Join Meeting
                  </Button>
                </Link>
              ) : (
                <Button variant="neon" disabled>
                  <VideoIcon className="mr-2 h-4 w-4" />
                  Meeting Ended
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        {meeting.description && (
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground">
              {meeting.description}
            </p>
          </CardContent>
        )}
      </Card>

      {/* Editable form for scheduled meetings */}
      {isEditable && (
        <MeetingForm
          defaultValues={{
            title: meeting.title,
            description: meeting.description,
            scheduled_at: meeting.scheduled_at,
            meeting_type_id: meeting.meeting_type_id,
          }}
          onSubmit={handleSubmit}
          isSubmitting={updateMeeting.isPending}
          submitLabel="Save Changes"
        />
      )}

      {/* Read-only detail for ended/cancelled meetings */}
      {!isEditable && (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-6 space-y-4">
            {meeting.started_at && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">
                  Started
                </span>
                <p className="text-sm">{formatDate(meeting.started_at)}</p>
              </div>
            )}
            {meeting.ended_at && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">
                  Ended
                </span>
                <p className="text-sm">{formatDate(meeting.ended_at)}</p>
              </div>
            )}
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                Room ID
              </span>
              <p className="text-sm font-mono text-muted-foreground">
                {meeting.livekit_room}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invite manager — host only */}
      {currentUser && meeting.user_id === currentUser.id && meeting.status !== 'ended' && meeting.status !== 'summarizing' && meeting.status !== 'cancelled' && (
        <div className="mt-8">
          <InviteManager meetingId={id} />
        </div>
      )}
    </div>
  );
}
