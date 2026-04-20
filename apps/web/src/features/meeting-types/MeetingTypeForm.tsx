import { useForm, Controller } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { CreateMeetingTypeReq } from '@meeting-app/shared';
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
import { LayoutListIcon } from 'lucide-react';
import { AgendaItemsInput } from './AgendaItemsInput';
import { AgentMultiSelect } from './AgentMultiSelect';

interface MeetingTypeFormProps {
  defaultValues?: {
    name?: string;
    description?: string | null;
    agenda_items?: string[] | null;
    agent_ids?: string[];
    buffer_size?: number;
  };
  onSubmit: (data: CreateMeetingTypeReq) => Promise<void>;
  isSubmitting: boolean;
  submitLabel: string;
}

export function MeetingTypeForm({
  defaultValues,
  onSubmit,
  isSubmitting,
  submitLabel,
}: MeetingTypeFormProps) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<CreateMeetingTypeReq>({
    resolver: standardSchemaResolver(CreateMeetingTypeReq),
    defaultValues: {
      name: defaultValues?.name ?? '',
      description: defaultValues?.description ?? undefined,
      agenda_items: defaultValues?.agenda_items ?? [],
      agent_ids: defaultValues?.agent_ids ?? [],
      buffer_size: defaultValues?.buffer_size ?? 10,
    },
  });

  return (
    <div className="w-full max-w-4xl mx-auto grid grid-cols-1 gap-8 lg:grid-cols-[1fr_280px]">
      {/* Main form */}
      <Card variant="solid" className="shadow-lg">
        <CardHeader className="pb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--neon)]/10">
              <LayoutListIcon className="h-5 w-5 text-[var(--neon)]" />
            </div>
            <div>
              <CardTitle className="text-xl">
                {defaultValues ? 'Edit Meeting Type' : 'Create Meeting Type'}
              </CardTitle>
              <CardDescription>
                Define an agenda, pick agents, and set the buffer cadence
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit((data) => onSubmit(data))}
            className="flex flex-col gap-6"
          >
            {/* Name */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="name" className="text-sm font-medium">
                Name
              </Label>
              <Input
                id="name"
                placeholder="e.g. Sales Discovery Call, Sprint Retrospective"
                {...register('name')}
                aria-invalid={!!errors.name}
              />
              {errors.name && (
                <p className="text-xs text-destructive">
                  {errors.name.message}
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
                placeholder="Describe when this meeting type should be used..."
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

            {/* Agenda Items */}
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium">Agenda Items</Label>
              <Controller
                control={control}
                name="agenda_items"
                render={({ field }) => (
                  <AgendaItemsInput
                    value={field.value ?? []}
                    onChange={field.onChange}
                  />
                )}
              />
              {errors.agenda_items && (
                <p className="text-xs text-destructive">
                  {errors.agenda_items.message}
                </p>
              )}
            </div>

            {/* Agents */}
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium">Agents</Label>
              <Controller
                control={control}
                name="agent_ids"
                render={({ field }) => (
                  <AgentMultiSelect
                    value={field.value ?? []}
                    onChange={field.onChange}
                  />
                )}
              />
              {errors.agent_ids && (
                <p className="text-xs text-destructive">
                  {errors.agent_ids.message}
                </p>
              )}
            </div>

            {/* Buffer Size */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="buffer_size" className="text-sm font-medium">
                Buffer Size
              </Label>
              <Input
                id="buffer_size"
                type="number"
                min={1}
                max={100}
                placeholder="10"
                {...register('buffer_size', { valueAsNumber: true })}
                aria-invalid={!!errors.buffer_size}
                className="max-w-[180px]"
              />
              {errors.buffer_size ? (
                <p className="text-xs text-destructive">
                  {errors.buffer_size.message}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Number of transcript messages buffered before agents process
                  them.
                </p>
              )}
            </div>

            {/* Submit */}
            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                variant="neon"
                disabled={isSubmitting}
                className="min-w-[180px]"
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
                <span className="font-medium text-foreground">Name</span> — Use
                a descriptive name like &quot;Sales Discovery Call&quot; or
                &quot;Sprint Retrospective&quot;.
              </p>
              <p>
                <span className="font-medium text-foreground">
                  Agenda Items
                </span>{' '}
                — Add topics the AI should track during meetings. These will be
                used for structured post-meeting summaries.
              </p>
              <p>
                <span className="font-medium text-foreground">Agents</span> —
                Select which AI agents should run during meetings of this type.
                All selected agents fire in parallel.
              </p>
              <p>
                <span className="font-medium text-foreground">
                  Buffer Size
                </span>{' '}
                — Controls how many transcript messages are buffered before
                sending to agents. Lower = more frequent updates, higher = more
                context per update.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
