# UI System — Developer Guide

AwtoMeet's visual identity: **glass** surfaces, **handwritten** display type, **violet + cyan neon** accents, sparingly applied. Default is calm; neon is reserved.

## Stack

| Layer | Technology |
|-------|-----------|
| CSS Framework | Tailwind CSS v4 (Vite plugin) |
| Component Library | shadcn (base-nova) on Base UI React |
| Icons | Lucide React |
| Theming | next-themes (`attribute="class"`) |
| State (UI) | Zustand |
| Animations | tw-animate-css |
| Display font | Caveat Variable (`--font-heading`) |
| Body font | Geist Variable (`--font-sans`) |

## Color System (OKLCH)

All colors are defined as CSS custom properties in `apps/web/src/index.css` (`:root` + `.dark`). **Never hardcode hex, rgb, or arbitrary hues.** Use Tailwind token classes: `bg-background`, `text-foreground`, `border-border`, `bg-card`, `bg-sidebar`, `text-primary`, etc.

### Semantic tokens (values rebranded; names unchanged)

`--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--border`, `--input`, `--ring`, `--sidebar*`.

### Brand tokens (new)

| Token | Purpose |
|---|---|
| `--neon` | Violet — the primary neon hue. Reach it via `[var(--neon)]`, `bg-neon`, `text-neon`, or `shadow-neon`. |
| `--neon-accent` | Cyan — the "live/active" neon. Used on live indicators, SSE pills, focus accents. |
| `--glass` | Semi-transparent card fill (applied by the `.glass` utility). |
| `--glass-border` | Subtle border on glass surfaces. |
| `--blur-glass` | `16px` — canonical backdrop-blur radius. |

### Palette at a glance

**Light** — warm paper background (`oklch(0.985 0.008 85)`), deep-indigo ink text, violet primary (`oklch(0.55 0.22 290)`), cyan accent (`oklch(0.7 0.18 220)`).

**Dark** — blue-tinted near-black (`oklch(0.14 0.03 280)`), near-white text, violet primary (`oklch(0.7 0.25 290)`), cyan accent (`oklch(0.82 0.18 200)`).

### Provider badges (unchanged)

- OpenAI: `bg-emerald-500/10 text-emerald-600 dark:text-emerald-400`
- Anthropic: `bg-orange-500/10 text-orange-600 dark:text-orange-400`
- Default: `bg-muted text-muted-foreground`

### Rules

1. Prefer token classes. Arbitrary hues only for provider badges and the ambient body gradient.
2. Neon is for emphasis, never decoration. **At most one neon-glowing element per viewport** outside of hover states.
3. Never apply neon to text — only `box-shadow` / `border`.

## Dark Mode

Wired via `next-themes` with `attribute="class"`. Custom variant `@custom-variant dark (&:is(.dark *))` in `index.css`. Toggle in `src/components/ui/theme-toggle.tsx` cycles light → dark → system.

Rules:
1. Don't use `dark:` variants unless the component needs dark-specific overrides beyond token switching.
2. CSS variables handle most light/dark switching automatically.
3. Glass + neon reads stronger on dark. Dark mode is the "hero" theme; light mode is the daytime-friendly fallback.

## Typography

| Token | Font | Use |
|---|---|---|
| `font-sans` | Geist Variable | Everything by default. Body, labels, forms, tables, data, buttons, nav, descriptions. |
| `font-heading` | Caveat Variable | **Display only.** Page H1 (≥24px), empty-state titles, brand wordmark, hero card greetings. |

**Hard rules:**
1. Never apply `font-heading` below `text-xl` (20px). Caveat is unreadable at small sizes.
2. Never apply `font-heading` to table headers, form labels, data, buttons, or nav items.
3. Weights: Caveat 400 for hero H1s, 500–600 for page titles.

`CardTitle` exposes a `display` boolean prop (default `false`). Flip it on empty-state titles and hero cards; leave it off on data-dense cards.

## Glassmorphism

Apply the `.glass` utility (registered via Tailwind v4 `@utility` in `index.css`) to any surface that should be frosted: `<div class="glass rounded-2xl p-6">`. It sets `backdrop-filter: blur(16px) saturate(140%)`, semi-transparent fill, and a subtle border.

Scope — where glass applies:
- Sidebar, popovers, dialogs, select menus, toasts — always glass.
- Cards — glass by default (`<Card variant="glass">`). Use `<Card variant="solid">` for forms where readability beats flourish.
- Tables, transcript feeds, input fields — opaque. Never glass.

Accessibility:
- Body renders a fixed ambient gradient (`body::before`) behind everything so glass has something to blur. Don't remove it.
- On viewports ≤768px the `.glass` utility drops the blur and falls back to solid `--card` (perf).
- `prefers-reduced-motion` disables transitions/animations; blur stays (it's not motion).

## Neon Accents

Utility classes (registered via `@utility`):
- `.neon-ring` — violet glow (primary).
- `.neon-ring-accent` — cyan glow (live/active states).

Button variants in `src/components/ui/button.tsx`:
- `variant="default"` — filled violet with a subtle violet hover glow.
- `variant="neon"` — violet fill + persistent neon glow. Use for the primary CTA on hero pages (login, signup, "Start Meeting").
- `variant="glass"` — transparent glass button for secondary actions on glass surfaces.
- `variant="outline" | "secondary" | "ghost" | "destructive" | "link"` — unchanged semantics.

Badge variants:
- `variant="neon"` — cyan-glowing pill for "live" / "connected" / "running" indicators.

## App Shell

Every authenticated page is wrapped in `_auth.tsx` → `<AppShell>`.

```
┌─────────────────────────────────────────────┐
│ ═══ violet→cyan gradient accent ═══         │
│ 𝓐𝔀𝓽𝓸𝓜𝓮𝓮𝓽 (Caveat)   │                       │
│ ●                    │                       │
│ 📊 Dashboard         │   <main>              │
│ █ 🤖 Agents          │     <Outlet />        │
│   📅 Meetings        │                       │
│   📋 Meeting Types   │                       │
│ ───────────────────  │                       │
│ 🌙  Theme   [◀]     │                       │
│ [SA] Saif   [↗]     │                       │
└─────────────────────┴───────────────────────┘
```

Active nav item carries a left-edge violet bar with a soft violet glow (`before:` pseudo-element) plus a violet-tinted background.

### Files

| File | Purpose |
|------|---------|
| `src/components/layout/app-shell.tsx` | Flex container: sidebar + main |
| `src/components/layout/sidebar.tsx` | Glass sidebar, Caveat wordmark, neon-active nav, theme toggle, collapse |
| `src/lib/sidebar-store.ts` | Zustand store for collapse state (persisted) |
| `src/components/ui/theme-toggle.tsx` | Sun/Moon/Monitor cycle |

### Adding a Nav Item

Edit `navItems` in `sidebar.tsx`:
```tsx
const navItems = [
  { to: '/dashboard' as const, label: 'Dashboard', icon: LayoutDashboardIcon },
  // add here
];
```
Active state is detected via `useMatchRoute({ to, fuzzy: true })`.

## Page Layout Pattern

```tsx
function MyPage() {
  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          {/* Heading: Caveat only if this is THE page H1 */}
          <h1 className="font-heading text-4xl leading-none tracking-tight">Page Title</h1>
          <p className="mt-2 text-sm text-muted-foreground">Subtitle in Geist</p>
        </div>
      </div>
      {/* Content */}
    </div>
  );
}
```

- `max-w-5xl` for list / dashboard pages.
- `max-w-4xl` for form pages.
- `p-6 lg:p-8` responsive padding.
- `<main>` handles scroll. Pages do NOT set `h-screen` or `overflow`.

## Card Patterns

### Glass card (default)
```tsx
<Card className="group relative overflow-hidden transition-all duration-200
                 hover:shadow-[0_0_24px_-4px_oklch(from_var(--neon)_l_c_h/50%)]">
  <CardHeader>…</CardHeader>
  <CardContent>…</CardContent>
</Card>
```

### Form / solid card (readability over aesthetic)
```tsx
<Card variant="solid">
  <CardHeader>…</CardHeader>
  <CardContent>{/* form fields */}</CardContent>
</Card>
```

### Empty state
```tsx
<Card className="border-dashed">
  <CardContent className="flex flex-col items-center justify-center py-20">
    <div className="glass neon-ring flex h-16 w-16 items-center justify-center rounded-2xl mb-5">
      <SparklesIcon className="h-8 w-8 text-[var(--neon)]" />
    </div>
    <CardTitle display className="mb-2">No agents yet</CardTitle>
    <CardDescription className="text-center max-w-sm mb-6">
      Create one to get started.
    </CardDescription>
    <Button variant="neon">Create agent</Button>
  </CardContent>
</Card>
```

### Skeleton loading
```tsx
<div className="glass rounded-2xl p-5 animate-pulse">
  <div className="flex items-center gap-3 mb-4">
    <div className="h-9 w-9 rounded-lg bg-muted" />
    <div className="flex-1 space-y-2">
      <div className="h-4 w-28 rounded bg-muted" />
      <div className="h-3 w-full rounded bg-muted" />
    </div>
  </div>
</div>
```

## Form Pattern

Forms use `react-hook-form` + `standardSchemaResolver` + Zod schemas from `@meeting-app/shared`. **Form containers are opaque (`variant="solid"`), not glass.** Readability beats flourish.

### Field
```tsx
<div className="flex flex-col gap-2">
  <Label htmlFor="field" className="text-sm font-medium">Field Name</Label>
  <Input id="field" {...register('field')} aria-invalid={!!errors.field} />
  {errors.field && <p className="text-xs text-destructive">{errors.field.message}</p>}
</div>
```

Focus rings are violet automatically via `--ring`.

### Visual selection (small option sets)
```tsx
<button type="button"
  className={`flex flex-col items-center gap-1.5 rounded-lg border-2 px-3 py-3 transition-all cursor-pointer ${
    isActive
      ? 'border-[var(--neon)] neon-ring bg-[var(--neon)]/10'
      : 'border-border hover:border-[var(--neon)]/40'
  }`}>
  …
</button>
```

### Suggestion chips
Neutral muted pills — unchanged.

## Badge / Pill Pattern

```tsx
// Provider-specific (unchanged)
<span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium
                 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">OpenAI</span>

// Neutral
<span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px]
                 font-medium text-muted-foreground">gpt-4o-mini</span>

// Live / active (new)
<Badge variant="neon">LIVE</Badge>
```

## Icon Usage

Use **Lucide React**. Standard sizes: `h-4 w-4` inline, `h-5 w-5` card headers, `h-8 w-8` empty states. Colors via `text-[var(--neon)]`, `text-[var(--neon-accent)]`, or `text-muted-foreground`. Do not pair icons with gradients — solid neon only.

## Transition Defaults

- Hover effects: `transition-all duration-200`
- Opacity reveals: `transition-opacity duration-200`
- Color changes: `transition-colors`
- Sidebar collapse: `transition-all duration-200`

All disabled when `prefers-reduced-motion: reduce`.

## File Structure Convention

```
src/
├── components/
│   ├── layout/          # App shell, sidebar (shared chrome)
│   └── ui/              # shadcn primitives
├── features/
│   └── {feature}/
│       ├── hooks.ts
│       ├── *.tsx
│       └── __tests__/
├── hooks/               # Shared hooks (useMe, etc.)
├── lib/                 # api.ts, auth-store.ts, sidebar-store.ts, utils.ts
├── routes/              # TanStack Router file-based routes
│   ├── _auth.tsx
│   └── _auth/
└── mocks/               # MSW handlers
```

## Adding a New CRUD Module

1. **Hooks**: `src/features/{name}/hooks.ts` — TanStack Query hooks.
2. **Form**: `src/features/{name}/{Name}Form.tsx` — two-column, `variant="solid"` card.
3. **Routes**:
   - `src/routes/_auth/{name}/index.tsx` — glass card grid.
   - `src/routes/_auth/{name}/new.tsx` — form page, solid card.
   - `src/routes/_auth/{name}/$id.tsx` — edit page, solid card.
4. **Sidebar**: add nav item.
5. **Vite proxy**: already handled — `/api/v0` prefix.

## Rebrand reference (what changed from the prior guide)

- Product rename: **MojoMeet → AwtoMeet** in every user-visible surface.
- Background is warm off-white (light) / deep indigo-black (dark), not pure white/black.
- Brand color is violet (`--neon`) with cyan (`--neon-accent`) for live states. No more blue-violet-pink gradients.
- Cards are glass by default; opt out with `variant="solid"` on forms.
- Page H1s and empty-state titles use Caveat (`font-heading`). Body stays Geist.
- Primary CTA has neon glow (`variant="neon"` on hero pages, `variant="default"` elsewhere).
- Ambient radial-gradient backdrop lives on `body::before` so glass has something to blur.
