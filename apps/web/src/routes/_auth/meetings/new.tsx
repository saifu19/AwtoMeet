import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ArrowLeftIcon } from 'lucide-react';
import type { CreateMeetingReq } from '@meeting-app/shared';
import { Button } from '@/components/ui/button';
import { MeetingForm } from '@/features/meetings/MeetingForm';
import { useCreateMeeting } from '@/features/meetings/hooks';
import { ApiError } from '@/lib/api';

export const Route = createFileRoute('/_auth/meetings/new')({
  component: NewMeetingPage,
});

function NewMeetingPage() {
  const navigate = useNavigate();
  const createMeeting = useCreateMeeting();

  const handleSubmit = async (data: CreateMeetingReq) => {
    try {
      const meeting = await createMeeting.mutateAsync(data);
      toast.success(`Meeting "${meeting.title}" created successfully`);
      navigate({ to: '/meetings' });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.body?.message ?? err.message
          : 'Failed to create meeting';
      toast.error(message);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <Link to="/meetings">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground mb-6"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to meetings
        </Button>
      </Link>
      <MeetingForm
        onSubmit={handleSubmit}
        isSubmitting={createMeeting.isPending}
        submitLabel="Create Meeting"
      />
    </div>
  );
}
