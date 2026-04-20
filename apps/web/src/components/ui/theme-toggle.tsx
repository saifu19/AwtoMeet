import { useTheme } from 'next-themes';
import { SunIcon, MoonIcon, MonitorIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

const icons = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
} as const;

const cycle = ['light', 'dark', 'system'] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const current = (theme ?? 'system') as (typeof cycle)[number];
  const Icon = icons[current] ?? MonitorIcon;
  const idx = cycle.indexOf(current);
  const next = cycle[(idx === -1 ? 0 : idx + 1) % cycle.length];

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next ?? 'system')}
      aria-label={`Switch to ${next} theme`}
      className="h-8 w-8"
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
