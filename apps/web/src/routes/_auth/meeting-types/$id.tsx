import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ArrowLeftIcon } from 'lucide-react';
import type { CreateMeetingTypeReq } from '@meeting-app/shared';
import { Button } from '@/components/ui/button';
import { MeetingTypeForm } from '@/features/meeting-types/MeetingTypeForm';
import {
  useMeetingType,
  useUpdateMeetingType,
} from '@/features/meeting-types/hooks';

export const Route = createFileRoute('/_auth/meeting-types/$id')({
  component: EditMeetingTypePage,
});

function EditMeetingTypePage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data: meetingType, isLoading } = useMeetingType(id);
  const updateMeetingType = useUpdateMeetingType();

  const handleSubmit = async (data: CreateMeetingTypeReq) => {
    try {
      const updated = await updateMeetingType.mutateAsync({ id, data });
      toast.success(`Meeting type "${updated.name}" updated successfully`);
      navigate({ to: '/meeting-types' });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update meeting type',
      );
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl p-6 lg:p-8">
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  if (!meetingType) {
    return (
      <div className="mx-auto max-w-5xl p-6 lg:p-8">
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-muted-foreground mb-4">Meeting type not found</p>
          <Link to="/meeting-types">
            <Button variant="outline">Back to meeting types</Button>
          </Link>
        </div>
      </div>
    );
  }

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
        defaultValues={{
          name: meetingType.name,
          description: meetingType.description,
          agenda_items: meetingType.agenda_items,
          agent_ids: meetingType.agent_ids,
          buffer_size: meetingType.buffer_size,
        }}
        onSubmit={handleSubmit}
        isSubmitting={updateMeetingType.isPending}
        submitLabel="Save Changes"
      />
    </div>
  );
}
