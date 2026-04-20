import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ArrowLeftIcon } from 'lucide-react';
import type { CreateMeetingTypeReq } from '@meeting-app/shared';
import { Button } from '@/components/ui/button';
import { MeetingTypeForm } from '@/features/meeting-types/MeetingTypeForm';
import { useCreateMeetingType } from '@/features/meeting-types/hooks';

export const Route = createFileRoute('/_auth/meeting-types/new')({
  component: NewMeetingTypePage,
});

function NewMeetingTypePage() {
  const navigate = useNavigate();
  const createMeetingType = useCreateMeetingType();

  const handleSubmit = async (data: CreateMeetingTypeReq) => {
    try {
      const mt = await createMeetingType.mutateAsync(data);
      toast.success(`Meeting type "${mt.name}" created successfully`);
      navigate({ to: '/meeting-types' });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create meeting type',
      );
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <Link to="/meeting-types">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground mb-6"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to meeting types
        </Button>
      </Link>
      <MeetingTypeForm
        onSubmit={handleSubmit}
        isSubmitting={createMeetingType.isPending}
        submitLabel="Create Meeting Type"
      />
    </div>
  );
}
