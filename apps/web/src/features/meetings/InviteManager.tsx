import { useState } from 'react';
import { toast } from 'sonner';
import {
  MailIcon,
  CopyIcon,
  Trash2Icon,
  CheckCircleIcon,
  ClockIcon,
  PlusIcon,
  LinkIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  useInvites,
  useCreateInvite,
  useDeleteInvite,
} from './invite-hooks';
import { ApiError } from '@/lib/api';

interface InviteManagerProps {
  meetingId: string;
}

export function InviteManager({ meetingId }: InviteManagerProps) {
  const { data: invites, isLoading } = useInvites(meetingId);
  const createInvite = useCreateInvite(meetingId);
  const deleteInvite = useDeleteInvite(meetingId);

  const [email, setEmail] = useState('');
  const [canViewInsights, setCanViewInsights] = useState(false);

  const guestLink = `${window.location.origin}/join/${meetingId}`;

  const handleAddInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      await createInvite.mutateAsync({
        invited_email: email.trim(),
        can_view_insights: canViewInsights,
      });
      toast.success(`Invite sent to ${email}`);
      setEmail('');
      setCanViewInsights(false);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.body?.message ?? err.message
          : 'Failed to create invite';
      toast.error(msg);
    }
  };

  const handleDelete = async (inviteId: string, invitedEmail: string) => {
    try {
      await deleteInvite.mutateAsync(inviteId);
      toast.success(`Invite for ${invitedEmail} removed`);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.body?.message ?? err.message
          : 'Failed to delete invite';
      toast.error(msg);
    }
  };

  const copyLink = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success('Link copied to clipboard');
  };

  return (
    <Card variant="solid" className="shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--neon)]/10">
            <MailIcon className="h-4 w-4 text-[var(--neon)]" />
          </div>
          <div>
            <CardTitle className="text-base">Invites & Sharing</CardTitle>
            <CardDescription>
              Invite people by email or share the guest link
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Guest link */}
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium text-muted-foreground">
            Guest join link (no sign-up required)
          </Label>
          <div className="flex gap-2">
            <Input
              readOnly
              value={guestLink}
              className="text-xs font-mono bg-muted/30"
            />
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => copyLink(guestLink)}
            >
              <CopyIcon className="h-3.5 w-3.5 mr-1.5" />
              Copy
            </Button>
          </div>
        </div>

        {/* Add invite form */}
        <form onSubmit={handleAddInvite} className="flex flex-col gap-3">
          <Label className="text-xs font-medium text-muted-foreground">
            Invite by email
          </Label>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="alice@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1"
            />
            <Button
              type="submit"
              size="sm"
              variant="neon"
              disabled={!email.trim() || createInvite.isPending}
              className="shrink-0"
            >
              <PlusIcon className="h-3.5 w-3.5 mr-1.5" />
              {createInvite.isPending ? 'Sending...' : 'Invite'}
            </Button>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={canViewInsights}
              onCheckedChange={(v) => setCanViewInsights(v === true)}
            />
            <span className="text-xs text-muted-foreground">
              Allow access to insights & transcript
            </span>
          </label>
        </form>

        {/* Invite list */}
        {isLoading && (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-12 rounded-lg bg-muted/30 animate-pulse"
              />
            ))}
          </div>
        )}

        {!isLoading && invites && invites.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">
              Invited ({invites.length})
            </Label>
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {inv.invited_email}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {inv.accepted_at ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                        <CheckCircleIcon className="h-3 w-3" />
                        Accepted
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <ClockIcon className="h-3 w-3" />
                        Pending
                      </span>
                    )}
                    {inv.can_view_insights && (
                      <span className="text-[11px] text-violet-600 dark:text-violet-400">
                        Can view insights
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="h-7 w-7 shrink-0"
                  title="Copy invite link"
                  onClick={() =>
                    copyLink(
                      `${window.location.origin}/invites/${inv.invite_token}`,
                    )
                  }
                >
                  <LinkIcon className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="h-7 w-7 shrink-0 hover:text-destructive"
                  onClick={() => handleDelete(inv.id, inv.invited_email)}
                  disabled={deleteInvite.isPending}
                >
                  <Trash2Icon className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {!isLoading && (!invites || invites.length === 0) && (
          <p className="text-xs text-muted-foreground text-center py-2">
            No invites yet. Add one above or share the guest link.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
