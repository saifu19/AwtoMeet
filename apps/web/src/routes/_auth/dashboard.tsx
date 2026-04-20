import { createFileRoute, Link } from '@tanstack/react-router';
import { useMe } from '@/hooks/useMe';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  BotIcon,
  PlusIcon,
  CalendarIcon,
  LayoutListIcon,
  MailIcon,
  CheckCircleIcon,
  ClockIcon,
  VideoIcon,
} from 'lucide-react';
import { useMeetings } from '@/features/meetings/hooks';
import {
  usePendingInvites,
  useAcceptInvite,
} from '@/features/meetings/invite-hooks';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';

export const Route = createFileRoute('/_auth/dashboard')({
  component: DashboardPage,
});

function formatRelativeDate(iso: string | null) {
  if (!iso) return 'No date';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function DashboardPage() {
  const { data: user } = useMe();
  const { data: upcoming, isLoading: upcomingLoading } =
    useMeetings('scheduled');
  const { data: recent, isLoading: recentLoading } = useMeetings('ended');
  const { data: pendingInvites, isLoading: pendingLoading } =
    usePendingInvites();
  const acceptInvite = useAcceptInvite();

  const handleAcceptInvite = async (token: string) => {
    try {
      const res = await acceptInvite.mutateAsync(token);
      toast.success('Invite accepted!');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.body?.message ?? err.message
          : 'Failed to accept invite';
      toast.error(msg);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="font-heading text-4xl leading-none tracking-tight">
          Hi, {user?.display_name?.split(' ')[0] ?? 'there'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Here&apos;s an overview of your AwtoMeet workspace.
        </p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/meetings/new" className="block">
          <Card className="group relative overflow-hidden transition-all duration-200 hover:shadow-[0_0_24px_-4px_oklch(from_var(--neon)_l_c_h/50%)] cursor-pointer h-full">
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[var(--neon)] to-[var(--neon-accent)] opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
            <CardHeader>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--neon)]/10 mb-2">
                <CalendarIcon className="h-5 w-5 text-[var(--neon)]" />
              </div>
              <CardTitle className="text-sm">New Meeting</CardTitle>
              <CardDescription>
                Schedule a meeting and invite participants.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link to="/agents/new" className="block">
          <Card className="group relative overflow-hidden transition-all duration-200 hover:shadow-[0_0_24px_-4px_oklch(from_var(--neon)_l_c_h/50%)] cursor-pointer h-full">
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[var(--neon)] to-[var(--neon-accent)] opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
            <CardHeader>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--neon)]/10 mb-2">
                <PlusIcon className="h-5 w-5 text-[var(--neon)]" />
              </div>
              <CardTitle className="text-sm">Create Agent</CardTitle>
              <CardDescription>
                Set up a new AI agent to process your meeting content.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link to="/agents" className="block">
          <Card className="group relative overflow-hidden transition-all duration-200 hover:shadow-[0_0_24px_-4px_oklch(from_var(--neon-accent)_l_c_h/50%)] cursor-pointer h-full">
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[var(--neon-accent)] to-[var(--neon)] opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
            <CardHeader>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--neon-accent)]/10 mb-2">
                <BotIcon className="h-5 w-5 text-[var(--neon-accent)]" />
              </div>
              <CardTitle className="text-sm">Manage Agents</CardTitle>
              <CardDescription>
                View and configure your existing AI agents.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link to="/meeting-types" className="block">
          <Card className="group relative overflow-hidden transition-all duration-200 hover:shadow-[0_0_24px_-4px_oklch(from_var(--neon)_l_c_h/50%)] cursor-pointer h-full">
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[var(--neon)] to-[var(--neon-accent)] opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
            <CardHeader>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--neon)]/10 mb-2">
                <LayoutListIcon className="h-5 w-5 text-[var(--neon)]" />
              </div>
              <CardTitle className="text-sm">Meeting Types</CardTitle>
              <CardDescription>
                Define templates with agendas and AI agents.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {/* Pending Invites */}
      {!pendingLoading && pendingInvites && pendingInvites.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <MailIcon className="h-4 w-4 text-[var(--neon)]" />
            <h2 className="text-sm font-semibold">
              Pending Invites ({pendingInvites.length})
            </h2>
          </div>
          <div className="space-y-2">
            {pendingInvites.map((inv) => (
              <Card
                key={inv.id}
                className="group transition-all duration-200 hover:shadow-[0_0_20px_-4px_oklch(from_var(--neon)_l_c_h/40%)]"
              >
                <CardContent className="flex items-center gap-3 py-3 px-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--neon)]/10">
                    <MailIcon className="h-4 w-4 text-[var(--neon)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {inv.meeting_title}
                    </p>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <ClockIcon className="h-3 w-3" />
                      {inv.meeting_scheduled_at
                        ? formatRelativeDate(inv.meeting_scheduled_at)
                        : 'No date set'}
                      <span className="mx-1">·</span>
                      <span className="capitalize">{inv.meeting_status}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="neon"
                    className="shrink-0 h-7 px-3 text-xs"
                    disabled={acceptInvite.isPending}
                    onClick={() => handleAcceptInvite(inv.invite_token)}
                  >
                    <CheckCircleIcon className="h-3.5 w-3.5 mr-1" />
                    Accept
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Meetings */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Upcoming Meetings</h2>
          {upcoming && upcoming.length > 0 && (
            <Link
              to="/meetings"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View all
            </Link>
          )}
        </div>

        {upcomingLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-card p-4 animate-pulse"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-muted" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-32 rounded bg-muted" />
                    <div className="h-3 w-24 rounded bg-muted" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!upcomingLoading && (!upcoming || upcoming.length === 0) && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-10">
              <CalendarIcon className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground text-center mb-4">
                No upcoming meetings
              </p>
              <Link to="/meetings/new">
                <Button size="sm" variant="neon">
                  <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
                  Schedule a meeting
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {!upcomingLoading && upcoming && upcoming.length > 0 && (
          <div className="space-y-2">
            {upcoming.slice(0, 5).map((m) => (
              <Link
                key={m.id}
                to="/meetings/$id"
                params={{ id: m.id }}
                className="block"
              >
                <Card className="group transition-all duration-200 hover:shadow-[0_0_20px_-4px_oklch(from_var(--neon-accent)_l_c_h/40%)] cursor-pointer">
                  <CardContent className="flex items-center gap-3 py-3 px-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--neon-accent)]/10">
                      <VideoIcon className="h-4 w-4 text-[var(--neon-accent)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {m.title}
                      </p>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <ClockIcon className="h-3 w-3" />
                        {formatRelativeDate(m.scheduled_at)}
                      </div>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-[var(--neon-accent)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--neon-accent)]">
                      Scheduled
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Recent Meetings */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Recent Meetings</h2>
          {recent && recent.length > 0 && (
            <Link
              to="/meetings"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View all
            </Link>
          )}
        </div>

        {recentLoading && (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-card p-4 animate-pulse"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-muted" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-32 rounded bg-muted" />
                    <div className="h-3 w-24 rounded bg-muted" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!recentLoading && (!recent || recent.length === 0) && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-10">
              <ClockIcon className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground text-center">
                No past meetings yet. Activity will appear here after your first
                meeting ends.
              </p>
            </CardContent>
          </Card>
        )}

        {!recentLoading && recent && recent.length > 0 && (
          <div className="space-y-2">
            {recent.slice(0, 5).map((m) => (
              <Link
                key={m.id}
                to="/meetings/$id"
                params={{ id: m.id }}
                className="block"
              >
                <Card className="group transition-all duration-200 hover:shadow-[0_0_20px_-4px_oklch(from_var(--foreground)_l_c_h/20%)] cursor-pointer">
                  <CardContent className="flex items-center gap-3 py-3 px-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <VideoIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {m.title}
                      </p>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <ClockIcon className="h-3 w-3" />
                        {formatRelativeDate(m.ended_at)}
                      </div>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Ended
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
