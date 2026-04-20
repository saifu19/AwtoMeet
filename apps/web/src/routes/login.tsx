import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { LoginReq, type AuthRes } from '@meeting-app/shared';
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
import { api, API_PREFIX } from '@/lib/api';
import { setAccessToken } from '@/lib/auth-store';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginReq>({
    resolver: standardSchemaResolver(LoginReq),
  });

  const onSubmit = async (data: LoginReq) => {
    try {
      const res = await api<AuthRes>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      setAccessToken(res.access);
      queryClient.setQueryData(['me'], res.user);
      navigate({ to: '/dashboard' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="neon-ring flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--neon)]/15 mb-3">
            <span className="block h-3 w-3 rounded-full bg-[var(--neon)] shadow-[0_0_16px_var(--neon)]" />
          </div>
          <h1 className="font-heading text-4xl leading-none tracking-tight">
            AwtoMeet
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            AI-powered meeting intelligence
          </p>
        </div>

        <Card variant="glass" className="shadow-xl">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-lg">Welcome back</CardTitle>
            <CardDescription>
              Enter your credentials to continue
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  {...register('email')}
                  aria-invalid={!!errors.email}
                />
                {errors.email && (
                  <p className="text-xs text-destructive">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  {...register('password')}
                  aria-invalid={!!errors.password}
                />
                {errors.password && (
                  <p className="text-xs text-destructive">
                    {errors.password.message}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                variant="neon"
                disabled={isSubmitting}
                className="w-full"
              >
                {isSubmitting ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>

            <div className="mt-5 flex flex-col gap-3">
              <div className="relative flex items-center">
                <div className="flex-1 border-t" />
                <span className="px-3 text-xs text-muted-foreground">or</span>
                <div className="flex-1 border-t" />
              </div>

              <a
                href={`${import.meta.env.VITE_API_URL}${API_PREFIX}/auth/google/start`}
                className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Continue with Google
              </a>

              <p className="text-center text-sm text-muted-foreground">
                Don&apos;t have an account?{' '}
                <Link
                  to="/signup"
                  className="text-primary font-medium hover:underline underline-offset-4"
                >
                  Create account
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
