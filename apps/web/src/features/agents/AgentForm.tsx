import { useForm, Controller } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { CreateAgentReq } from '@meeting-app/shared';
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
import { BotIcon, SparklesIcon, BrainCircuitIcon } from 'lucide-react';

interface AgentFormProps {
  defaultValues?: {
    name?: string;
    system_prompt?: string;
    provider?: string | null;
    model?: string | null;
  };
  onSubmit: (data: CreateAgentReq) => Promise<void>;
  isSubmitting: boolean;
  submitLabel: string;
}

type ProviderValue = 'openai' | 'anthropic' | undefined;

const PROVIDERS = [
  { value: '__default__', label: 'Default', icon: SparklesIcon, hint: 'Uses platform default' },
  { value: 'openai', label: 'OpenAI', icon: BrainCircuitIcon, hint: 'GPT models' },
  { value: 'anthropic', label: 'Anthropic', icon: BotIcon, hint: 'Claude models' },
] as const;

const MODEL_SUGGESTIONS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini'],
  anthropic: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
};

export function AgentForm({
  defaultValues,
  onSubmit,
  isSubmitting,
  submitLabel,
}: AgentFormProps) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateAgentReq>({
    resolver: standardSchemaResolver(CreateAgentReq),
    defaultValues: {
      name: defaultValues?.name ?? '',
      system_prompt: defaultValues?.system_prompt ?? '',
      provider: (defaultValues?.provider as ProviderValue) ?? undefined,
      model: defaultValues?.model ?? undefined,
    },
  });

  const watchedProvider = watch('provider');
  const watchedPrompt = watch('system_prompt');
  const suggestions = watchedProvider ? MODEL_SUGGESTIONS[watchedProvider] ?? [] : [];

  return (
    <div className="w-full max-w-4xl mx-auto grid grid-cols-1 gap-8 lg:grid-cols-[1fr_280px]">
      {/* Main form */}
      <Card variant="solid" className="shadow-lg">
        <CardHeader className="pb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--neon)]/10">
              <BotIcon className="h-5 w-5 text-[var(--neon)]" />
            </div>
            <div>
              <CardTitle className="text-xl">
                {defaultValues ? 'Edit Agent' : 'Create Agent'}
              </CardTitle>
              <CardDescription>
                Configure your AI agent&apos;s personality and capabilities
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit((data) => onSubmit(data))} className="flex flex-col gap-6">
            {/* Name */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="name" className="text-sm font-medium">
                Name
              </Label>
              <Input
                id="name"
                placeholder="e.g. Meeting Summarizer, Action Tracker"
                {...register('name')}
                aria-invalid={!!errors.name}
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              )}
            </div>

            {/* System Prompt */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="system_prompt" className="text-sm font-medium">
                System Prompt
              </Label>
              <Textarea
                id="system_prompt"
                placeholder="Describe what this agent should do during meetings. Be specific about the format and focus of its output..."
                rows={6}
                className="font-mono text-sm bg-muted/30 dark:bg-muted/20 min-h-[200px] resize-y"
                {...register('system_prompt')}
                aria-invalid={!!errors.system_prompt}
              />
              <div className="flex items-center justify-between">
                {errors.system_prompt ? (
                  <p className="text-xs text-destructive">
                    {errors.system_prompt.message}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    This prompt instructs the AI on how to process meeting content.
                  </p>
                )}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {watchedPrompt?.length ?? 0} chars
                </span>
              </div>
            </div>

            {/* Provider — visual card selection */}
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium">Provider</Label>
              <Controller
                control={control}
                name="provider"
                render={({ field }) => {
                  const selected = field.value ?? '__default__';
                  return (
                    <div className="grid grid-cols-3 gap-3">
                      {PROVIDERS.map((p) => {
                        const isActive = selected === p.value || (!field.value && p.value === '__default__');
                        return (
                          <button
                            key={p.value}
                            type="button"
                            onClick={() =>
                              field.onChange(p.value === '__default__' ? undefined : p.value)
                            }
                            className={`flex flex-col items-center gap-1.5 rounded-lg border-2 px-3 py-3 text-center transition-all cursor-pointer ${
                              isActive
                                ? 'border-primary ring-2 ring-primary/20 bg-primary/5'
                                : 'border-border hover:border-primary/40'
                            }`}
                          >
                            <p.icon className={`h-5 w-5 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                            <span className="text-xs font-medium">{p.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                }}
              />
              {errors.provider && (
                <p className="text-xs text-destructive">{errors.provider.message}</p>
              )}
            </div>

            {/* Model */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="model" className="text-sm font-medium">
                Model
              </Label>
              <Input
                id="model"
                placeholder="e.g. gpt-4o-mini, claude-sonnet-4-6"
                {...register('model')}
                aria-invalid={!!errors.model}
              />
              {errors.model && (
                <p className="text-xs text-destructive">{errors.model.message}</p>
              )}
              {suggestions.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-muted-foreground">Popular:</span>
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setValue('model', s)}
                      className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {!suggestions.length && (
                <p className="text-xs text-muted-foreground">
                  Leave empty to use the provider&apos;s default model.
                </p>
              )}
            </div>

            {/* Submit */}
            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                variant="neon"
                disabled={isSubmitting}
                className="min-w-[140px]"
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
          <Card variant="solid" className="bg-muted/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Tips</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-3">
              <p>
                <span className="font-medium text-foreground">Name</span> — Use
                a descriptive name like &quot;Action Item Tracker&quot; or
                &quot;Meeting Summarizer&quot;.
              </p>
              <p>
                <span className="font-medium text-foreground">System prompt</span>{' '}
                — Be specific about the output format. e.g. &quot;Return a
                bulleted list of action items with owners and deadlines.&quot;
              </p>
              <p>
                <span className="font-medium text-foreground">Provider</span> —
                Choose &quot;Default&quot; to use the platform setting, or pick a
                specific provider for this agent.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
