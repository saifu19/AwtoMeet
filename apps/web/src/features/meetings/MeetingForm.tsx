import { useForm, Controller } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { z } from 'zod';
import type { CreateMeetingReq } from '@meeting-app/shared';
import { UlidSchema } from '@meeting-app/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { CalendarIcon, SparklesIcon } from 'lucide-react';
import { useMeetingTypes } from '@/features/meeting-types/hooks';

// Form-local schema: accepts datetime-local strings (not strict ISO)
// We convert to ISO in the submit handler before sending to the API.
const MeetingFormSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  scheduled_at: z.string().optional(),
  meeting_type_id: UlidSchema.optional(),
  auto_classify: z.boolean().optional(),
});
type MeetingFormData = z.infer<typeof MeetingFormSchema>;

interface MeetingFormProps {
  defaultValues?: {
    title?: string;
    description?: string | null;
    scheduled_at?: string | null;
    meeting_type_id?: string | null;
  };
  onSubmit: (data: CreateMeetingReq) => Promise<void>;
  isSubmitting: boolean;
  submitLabel: string;
}

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MeetingForm({
  defaultValues,
  onSubmit,
  isSubmitting,
  submitLabel,
}: MeetingFormProps) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<MeetingFormData>({
    resolver: standardSchemaResolver(MeetingFormSchema),
    defaultValues: {
      title: defaultValues?.title ?? '',
      description: defaultValues?.description ?? undefined,
      scheduled_at: toDatetimeLocal(defaultValues?.scheduled_at) || undefined,
      meeting_type_id: defaultValues?.meeting_type_id ?? undefined,
    },
  });

  const { data: meetingTypes, isLoading: mtLoading } = useMeetingTypes();

  const selectedMeetingTypeName = (id: string | undefined) => {
    if (!id || !meetingTypes) return null;
    return meetingTypes.find((mt) => mt.id === id)?.name ?? null;
  };

  const handleFormSubmit = (data: MeetingFormData) => {
    const payload: CreateMeetingReq = {
      title: data.title,
      description: data.description,
      meeting_type_id: data.meeting_type_id,
      auto_classify: data.auto_classify,
    };
    // Convert datetime-local value to ISO string
    if (data.scheduled_at) {
      payload.scheduled_at = new Date(data.scheduled_at).toISOString();
    }
    return onSubmit(payload);
  };

  return (
    <div className="w-full max-w-4xl mx-auto grid grid-cols-1 gap-8 lg:grid-cols-[1fr_280px]">
      {/* Main form */}
      <Card variant="solid" className="shadow-lg">
        <CardHeader className="pb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--neon)]/10">
              <CalendarIcon className="h-5 w-5 text-[var(--neon)]" />
            </div>
            <div>
              <CardTitle className="text-xl">
                {defaultValues ? 'Edit Meeting' : 'Schedule Meeting'}
              </CardTitle>
              <CardDescription>
                Set up a new meeting with optional type and schedule
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit(handleFormSubmit)}
            className="flex flex-col gap-6"
          >
            {/* Title */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="title" className="text-sm font-medium">
                Title
              </Label>
              <Input
                id="title"
                placeholder="e.g. Weekly Standup, Client Discovery Call"
                {...register('title')}
                aria-invalid={!!errors.title}
              />
              {errors.title && (
                <p className="text-xs text-destructive">
                  {errors.title.message}
                </p>
              )}
            </div>

            {/* Description */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="description" className="text-sm font-medium">
                Description
              </Label>
              <Textarea
                id="description"
                placeholder="What is this meeting about?"
                rows={3}
                {...register('description')}
                aria-invalid={!!errors.description}
              />
              {errors.description && (
                <p className="text-xs text-destructive">
                  {errors.description.message}
                </p>
              )}
            </div>

            {/* Scheduled At */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="scheduled_at" className="text-sm font-medium">
                Scheduled At
              </Label>
              <Input
                id="scheduled_at"
                type="datetime-local"
                className="max-w-[280px]"
                {...register('scheduled_at')}
                aria-invalid={!!errors.scheduled_at}
              />
              {errors.scheduled_at ? (
                <p className="text-xs text-destructive">
                  {errors.scheduled_at.message}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Leave empty for an ad-hoc meeting you can join anytime.
                </p>
              )}
            </div>

            {/* Meeting Type */}
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium">Meeting Type</Label>
              <Controller
                control={control}
                name="meeting_type_id"
                render={({ field }) => (
                  <Select
                    value={field.value ?? '__none__'}
                    onValueChange={(val: string | null) => {
                      const next = !val || val === '__none__' ? undefined : val;
                      field.onChange(next);
                      if (next) setValue('auto_classify', false);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={mtLoading ? 'Loading...' : 'None (no type)'}>
                        {selectedMeetingTypeName(field.value) ?? (mtLoading ? 'Loading...' : 'None (no type)')}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {meetingTypes?.map((mt) => (
                        <SelectItem key={mt.id} value={mt.id}>
                          {mt.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.meeting_type_id && (
                <p className="text-xs text-destructive">
                  {errors.meeting_type_id.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Attach a meeting type to enable AI agents and agenda tracking.
              </p>
            </div>

            {/* Auto-classify */}
            <Controller
              control={control}
              name="auto_classify"
              render={({ field }) => {
                const hasExplicitType = !!watch('meeting_type_id');
                return (
                  <label
                    className={`flex items-center gap-2.5 ${hasExplicitType ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <Checkbox
                      checked={hasExplicitType ? false : (field.value ?? false)}
                      onCheckedChange={(v) => {
                        if (!hasExplicitType) field.onChange(v === true);
                      }}
                      disabled={hasExplicitType}
                    />
                    <SparklesIcon className="h-3.5 w-3.5 text-[var(--neon)]" />
                    <span className="text-sm">
                      Auto-classify meeting type
                    </span>
                  </label>
                );
              }}
            />

            {/* Submit */}
            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                variant="neon"
                disabled={isSubmitting}
                className="min-w-[160px]"
              >
                {isSubmitting ? 'Saving...' : submitLabel}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Sidebar — tips panel */}
      <div className="hidden lg:block">
        <div className="sticky top-8 space-y-4">
          <Card className="border-0 shadow-sm bg-muted/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Tips</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-3">
              <p>
                <span className="font-medium text-foreground">Title</span> — A
                short, descriptive name for the meeting.
              </p>
              <p>
                <span className="font-medium text-foreground">
                  Scheduled At
                </span>{' '}
                — Set a date and time, or leave empty for ad-hoc meetings you
                can join immediately.
              </p>
              <p>
                <span className="font-medium text-foreground">
                  Meeting Type
                </span>{' '}
                — Choosing a type connects your AI agents and agenda items to
                this meeting.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
