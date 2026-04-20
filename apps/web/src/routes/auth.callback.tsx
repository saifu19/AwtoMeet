import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { setAccessToken } from '@/lib/auth-store';
import { api } from '@/lib/api';
import type { MeRes } from '@meeting-app/shared';

export const Route = createFileRoute('/auth/callback')({
  component: AuthCallbackPage,
});

// Read the access token from the URL fragment (never sent to the server),
// then scrub the fragment from history so it cannot leak via screenshots,
// password managers, or link-preview services.
function consumeAccessTokenFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return null;
  const params = new URLSearchParams(hash.slice(1));
  const access = params.get('access');
  // Wipe the fragment regardless of outcome.
  window.history.replaceState(
    null,
    '',
    window.location.pathname + window.location.search,
  );
  return access && access.length > 0 ? access : null;
}

function AuthCallbackPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    const access = consumeAccessTokenFromHash();
    if (!access) {
      navigate({ to: '/login' });
      return;
    }

    setAccessToken(access);

    api<MeRes>('/auth/me')
      .then((user) => {
        queryClient.setQueryData(['me'], user);
        navigate({ to: '/dashboard' });
      })
      .catch(() => {
        setAccessToken(null);
        navigate({ to: '/login' });
      });
  }, [navigate, queryClient]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">Signing you in...</p>
    </div>
  );
}
