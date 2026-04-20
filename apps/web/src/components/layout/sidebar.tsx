import { Link, useMatchRoute } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboardIcon,
  BotIcon,
  LayoutListIcon,
  CalendarIcon,
  LogOutIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { useMe } from '@/hooks/useMe';
import { useSidebarStore } from '@/lib/sidebar-store';
import { api } from '@/lib/api';
import { setAccessToken } from '@/lib/auth-store';

const navItems = [
  { to: '/dashboard' as const, label: 'Dashboard', icon: LayoutDashboardIcon },
  { to: '/agents' as const, label: 'Agents', icon: BotIcon },
  { to: '/meetings' as const, label: 'Meetings', icon: CalendarIcon },
  { to: '/meeting-types' as const, label: 'Meeting Types', icon: LayoutListIcon },
];

function getInitials(name: string) {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function Sidebar() {
  const { collapsed, toggle } = useSidebarStore();
  const { data: user } = useMe();
  const matchRoute = useMatchRoute();
  const queryClient = useQueryClient();

  const handleLogout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // continue logout even if request fails
    }
    setAccessToken(null);
    queryClient.clear();
    window.location.href = '/login';
  };

  return (
    <aside
      className={`glass flex flex-col h-screen border-r border-sidebar-border transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Violet → cyan neon accent line */}
      <div className="h-0.5 bg-gradient-to-r from-[var(--neon)] to-[var(--neon-accent)]" />

      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="neon-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--neon)]/15">
          <span className="block h-2.5 w-2.5 rounded-full bg-[var(--neon)] shadow-[0_0_12px_var(--neon)]" />
        </div>
        {!collapsed && (
          <span className="font-heading text-xl leading-none tracking-tight">
            AwtoMeet
          </span>
        )}
      </div>

      {/* Nav links */}
      <nav className="flex-1 space-y-1 px-2 py-2">
        {navItems.map((item) => {
          const isActive = !!matchRoute({ to: item.to, fuzzy: true });
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:left-0 before:inset-y-1 before:w-[3px] before:rounded-full before:bg-[var(--neon)] before:shadow-[0_0_12px_var(--neon)] before:content-['']"
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="space-y-2 border-t border-sidebar-border px-2 py-3">
        {/* Theme toggle + collapse */}
        <div className={`flex items-center ${collapsed ? 'flex-col gap-2' : 'justify-between px-1'}`}>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            className="h-8 w-8"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpenIcon className="h-4 w-4" />
            ) : (
              <PanelLeftCloseIcon className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* User info */}
        {user && (
          <div className={`flex items-center rounded-lg ${collapsed ? 'flex-col gap-2 px-0 py-1.5' : 'gap-2.5 px-2 py-1.5'}`}>
            <div className="glass flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium text-[var(--neon)]">
              {getInitials(user.display_name)}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="truncate text-xs font-medium">
                  {user.display_name}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {user.email}
                </p>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              className="h-7 w-7 shrink-0"
              aria-label="Logout"
            >
              <LogOutIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}
