import { useEffect, useRef } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { CheckCircleIcon, XCircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import {
  Card,
  CardContent,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useAcceptInvite } from '@/features/meetings/invite-hooks';

export const Route = createFileRoute('/_auth/invites/$token')({
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const acceptInvite = useAcceptInvite();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    acceptInvite
      .mutateAsync(token)
      .then((res) => {
        toast.success('Invite accepted! Redirecting to meeting...');
        navigate({ to: '/meetings/$id', params: { id: res.meeting_id } });
      })
      .catch(() => {
        // Error state is handled by the render below
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Loading
  if (acceptInvite.isPending) {
    return (
      <div className="mx-auto max-w-md p-6 lg:p-8 mt-20">
        <Card className="border-0 shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mb-4" />
            <p className="text-sm text-muted-foreground">
              Accepting invite...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error
  if (acceptInvite.isError) {
    const err = acceptInvite.error;
    const status = err instanceof ApiError ? err.status : 0;
    const isForbidden = status === 403;
    const isNotFound = status === 404;

    return (
      <div className="mx-auto max-w-md p-6 lg:p-8 mt-20">
        <Card className="border-0 shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 mb-4">
              <XCircleIcon className="h-7 w-7 text-red-600 dark:text-red-400" />
            </div>
            <CardTitle className="text-lg mb-2">
              {isForbidden
                ? 'Wrong email'
                : isNotFound
                  ? 'Invite not found'
                  : 'Something went wrong'}
            </CardTitle>
            <CardDescription className="text-center max-w-xs mb-6">
              {isForbidden
                ? 'This invite is for a different email address. Please log in with the correct account.'
                : isNotFound
                  ? 'This invite link may have expired or been revoked.'
                  : 'Failed to accept the invite. Please try again.'}
            </CardDescription>
            <Button
              variant="outline"
              onClick={() => navigate({ to: '/dashboard' })}
            >
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success (brief flash before redirect)
  return (
    <div className="mx-auto max-w-md p-6 lg:p-8 mt-20">
      <Card className="border-0 shadow-lg">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 mb-4">
            <CheckCircleIcon className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-sm text-muted-foreground">
            Invite accepted! Redirecting...
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
