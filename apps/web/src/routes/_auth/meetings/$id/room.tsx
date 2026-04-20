import { useEffect, useState, useRef } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { LiveKitRoom, VideoConference } from '@livekit/components-react';
import { toast } from 'sonner';
import { ArrowLeftIcon, SparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LiveCaptions } from '@/components/room/LiveCaptions';
import {
  useJoinMeeting,
  useLeaveMeeting,
  useMeeting,
} from '@/features/meetings/hooks';

export const Route = createFileRoute('/_auth/meetings/$id/room')({
  component: MeetingRoomPage,
});

function MeetingRoomPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const joinMeeting = useJoinMeeting();
  const leaveMeeting = useLeaveMeeting();
  // useMeeting shares the React Query cache with MeetingDetailPage, so this
  // usually resolves from cache when the user arrived via the detail page.
  // We only read it to gate the "Open Insights" button visibility.
  const { data: meeting } = useMeeting(id);
  const canOpenInsights = meeting?.viewer_can_view_insights === true;
  const [connection, setConnection] = useState<{
    url: string;
    token: string;
  } | null>(null);
  const joinAttempted = useRef(false);

  // Join on mount — once only
  useEffect(() => {
    if (joinAttempted.current) return;
    joinAttempted.current = true;

    joinMeeting
      .mutateAsync(id)
      .then((res) => {
        setConnection({ url: res.livekit_url, token: res.livekit_token });
      })
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : 'Failed to join meeting',
        );
        navigate({ to: '/meetings/$id', params: { id } });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleDisconnect = () => {
    leaveMeeting.mutate(id);
    navigate({ to: '/meetings/$id', params: { id } });
  };

  // Loading state
  if (!connection) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent mb-4" />
        <p className="text-sm text-muted-foreground">
          Joining meeting...
        </p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Minimal header */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-background/95 backdrop-blur">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={handleDisconnect}
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Leave
        </Button>
        {canOpenInsights && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              window.open(`/meetings/${id}/insights`, '_blank', 'noopener')
            }
          >
            <SparklesIcon className="h-4 w-4" />
            Open Insights
          </Button>
        )}
      </div>

      {/* LiveKit room — fills remaining space */}
      <div className="flex-1 min-h-0">
        <LiveKitRoom
          serverUrl={connection.url}
          token={connection.token}
          connect={true}
          onDisconnected={handleDisconnect}
          data-lk-theme="default"
          style={{ height: '100%' }}
        >
          <VideoConference />
          <LiveCaptions />
        </LiveKitRoom>
      </div>
    </div>
  );
}
