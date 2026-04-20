import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import type { MeRes } from '@meeting-app/shared';
import { api, API_PREFIX } from '@/lib/api';
import { getAccessToken, setAccessToken } from '@/lib/auth-store';
import { AppShell } from '@/components/layout/app-shell';

export const Route = createFileRoute('/_auth')({
  beforeLoad: async ({ context }) => {
    const { queryClient } = context;

    // If no in-memory token, attempt a silent refresh using the
    // httpOnly refresh cookie (survives page reloads).
    if (!getAccessToken()) {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_URL ?? ''}${API_PREFIX}/auth/refresh`,
          { method: 'POST', credentials: 'include' },
        );
        if (res.ok) {
          const { access } = await res.json();
          setAccessToken(access);
        } else {
          throw redirect({ to: '/login' });
        }
      } catch (err) {
        // Re-throw redirects; everything else means no valid session
        if (err instanceof Response || (err && typeof err === 'object' && 'to' in err)) throw err;
        throw redirect({ to: '/login' });
      }
    }

    try {
      await queryClient.ensureQueryData({
        queryKey: ['me'],
        queryFn: () => api<MeRes>('/auth/me'),
      });
    } catch {
      throw redirect({ to: '/login' });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
