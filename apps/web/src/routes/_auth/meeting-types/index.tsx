import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
  LayoutListIcon,
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  SparklesIcon,
  CalendarIcon,
  BotIcon,
  ListIcon,
} from 'lucide-react';
import type { MeetingTypeSchema } from '@meeting-app/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  useMeetingTypes,
  useDeleteMeetingType,
} from '@/features/meeting-types/hooks';
import { ApiError } from '@/lib/api';

export const Route = createFileRoute('/_auth/meeting-types/')({
  component: MeetingTypesListPage,
});

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/* ── Skeleton card for loading state ────────────────────────── */
function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-5 animate-pulse">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-9 w-9 rounded-lg bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-28 rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted" />
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <div className="h-5 w-20 rounded-full bg-muted" />
        <div className="h-5 w-24 rounded-full bg-muted" />
      </div>
      <div className="h-3 w-24 rounded bg-muted mt-4" />
    </div>
  );
}

/* ── Meeting type card ──────────────────────────────────────── */
function MeetingTypeCard({
  meetingType,
  onDelete,
}: {
  meetingType: MeetingTypeSchema;
  onDelete: (mt: MeetingTypeSchema) => void;
}) {
  const agentCount = meetingType.agent_ids?.length ?? 0;
  const agendaCount = meetingType.agenda_items?.length ?? 0;

  return (
    <Card className="group relative overflow-hidden transition-all duration-200 hover:shadow-[0_0_24px_-4px_oklch(from_var(--neon)_l_c_h/50%)]">
      {/* Neon top accent — reveals on hover */}
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[var(--neon)] to-[var(--neon-accent)] opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

      {/* Hover actions — top right */}
      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <Link to="/meeting-types/$id" params={{ id: meetingType.id }}>
          <Button variant="ghost" size="icon-xs" className="h-7 w-7">
            <PencilIcon className="h-3.5 w-3.5" />
          </Button>
        </Link>
        <Button
          variant="ghost"
          size="icon-xs"
          className="h-7 w-7 hover:text-destructive"
          onClick={() => onDelete(meetingType)}
        >
          <Trash2Icon className="h-3.5 w-3.5" />
        </Button>
      </div>

      <CardHeader className="pb-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--neon)]/10">
            <LayoutListIcon className="h-4 w-4 text-[var(--neon)]" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-sm truncate">
              {meetingType.name}
            </CardTitle>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground line-clamp-2 mb-4 min-h-[2lh]">
          {meetingType.description || 'No description'}
        </p>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--neon)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--neon)]">
            <BotIcon className="h-3 w-3" />
            {agentCount} agent{agentCount !== 1 ? 's' : ''}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--neon-accent)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--neon-accent)]">
            <ListIcon className="h-3 w-3" />
            {agendaCount} agenda item{agendaCount !== 1 ? 's' : ''}
          </span>
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Buffer: {meetingType.buffer_size}
          </span>
        </div>

        {/* Date */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <CalendarIcon className="h-3 w-3" />
          {formatDate(meetingType.created_at)}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Page ─────────────────────────────────────────────────────── */
function MeetingTypesListPage() {
  const { data: meetingTypes, isLoading } = useMeetingTypes();
  const deleteMeetingType = useDeleteMeetingType();
  const [deleteTarget, setDeleteTarget] = useState<MeetingTypeSchema | null>(
    null,
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMeetingType.mutateAsync(deleteTarget.id);
      toast.success(`"${deleteTarget.name}" has been deleted`);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.body?.message ?? err.message
          : 'Failed to delete meeting type';
      toast.error(message);
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-heading text-4xl leading-none tracking-tight">Meeting Types</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Configure reusable meeting templates with agendas and AI agents
          </p>
        </div>
        <Link to="/meeting-types/new">
          <Button variant="neon">
            <PlusIcon className="mr-2 h-4 w-4" />
            New Meeting Type
          </Button>
        </Link>
      </div>

      {/* Loading state — skeleton cards */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (!meetingTypes || meetingTypes.length === 0) && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="glass neon-ring flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--neon)]/15 mb-5">
              <SparklesIcon className="h-8 w-8 text-[var(--neon)]" />
            </div>
            <CardTitle display className="mb-2">
              No meeting types yet
            </CardTitle>
            <CardDescription className="text-center max-w-sm mb-6">
              Meeting types bundle an agenda and a set of AI agents that will run
              during every meeting of this type.
            </CardDescription>
            <Link to="/meeting-types/new">
              <Button variant="neon">
                <PlusIcon className="mr-2 h-4 w-4" />
                Create your first meeting type
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Card grid */}
      {!isLoading && meetingTypes && meetingTypes.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {meetingTypes.map((mt) => (
            <MeetingTypeCard
              key={mt.id}
              meetingType={mt}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete meeting type</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-medium text-foreground">
                &quot;{deleteTarget?.name}&quot;
              </span>
              ? Existing meetings using this type will be preserved but
              unlinked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMeetingType.isPending}
            >
              {deleteMeetingType.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
