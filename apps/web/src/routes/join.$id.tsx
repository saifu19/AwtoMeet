import { useState, useEffect, useRef } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { LiveKitRoom, VideoConference } from '@livekit/components-react';
import { toast } from 'sonner';
import { VideoIcon, ArrowLeftIcon, UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getAccessToken } from '@/lib/auth-store';
import { useGuestJoinMeeting } from '@/features/meetings/hooks';
import { LiveCaptions } from '@/components/room/LiveCaptions';
import { ApiError } from '@/lib/api';

export const Route = createFileRoute('/join/$id')({
  component: GuestJoinPage,
});

function GuestJoinPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const guestJoin = useGuestJoinMeeting();

  const [displayName, setDisplayName] = useState('');
  const [connection, setConnection] = useState<{
    url: string;
    token: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const redirected = useRef(false);

  // If authenticated, redirect to the normal room page
  useEffect(() => {
    if (redirected.current) return;
    const token = getAccessToken();
    if (token) {
      redirected.current = true;
      navigate({ to: '/meetings/$id/room', params: { id } });
    }
  }, [id, navigate]);

  const handleGuestJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setError(null);

    try {
      const res = await guestJoin.mutateAsync({
        id,
        display_name: displayName.trim(),
      });
      setConnection({ url: res.livekit_url, token: res.livekit_token });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.body?.message ?? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to join';
      if (msg.includes('not started')) {
        setError('Meeting has not started yet. Please wait for the host to start it.');
      } else if (msg.includes('ended') || msg.includes('cancelled') || msg.includes('summarizing')) {
        setError('This meeting has ended.');
      } else if (msg.includes('not found') || (err instanceof ApiError && err.status === 404)) {
        setError('Meeting not found. Please check the link.');
      } else {
        setError(msg);
      }
    }
  };

  const handleDisconnect = () => {
    setConnection(null);
    setDisplayName('');
  };

  // Connected — show LiveKit room
  if (connection) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-background/95 backdrop-blur">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={handleDisconnect}
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Leave
          </Button>
          <span className="text-sm text-muted-foreground ml-2">
            Joined as {displayName}
          </span>
        </div>
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

  // Not connected — show name prompt
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card variant="glass" className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center">
          <div className="neon-ring flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--neon)]/15 mx-auto mb-3">
            <VideoIcon className="h-7 w-7 text-[var(--neon)]" />
          </div>
          <CardTitle className="text-xl">Join Meeting</CardTitle>
          <CardDescription>
            Enter your name to join as a guest — no account required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleGuestJoin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="display_name" className="text-sm font-medium">
                Your Name
              </Label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="display_name"
                  placeholder="e.g. John Doe"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive text-center bg-destructive/10 rounded-lg py-2 px-3">
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant="neon"
              disabled={!displayName.trim() || guestJoin.isPending}
              className="w-full"
            >
              <VideoIcon className="mr-2 h-4 w-4" />
              {guestJoin.isPending ? 'Joining...' : 'Join as Guest'}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Have an account?{' '}
              <a
                href="/login"
                className="text-primary underline-offset-2 hover:underline"
              >
                Sign in
              </a>{' '}
              for full access to insights and transcripts.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
