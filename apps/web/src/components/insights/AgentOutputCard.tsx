import ReactMarkdown from 'react-markdown';
import type { AgentOutputSchema } from '@meeting-app/shared';
import { formatTime } from '@/lib/utils';
import { remarkPlugins, markdownComponents } from '@/components/ui/markdown';

interface AgentOutputCardProps {
  output: AgentOutputSchema;
  accentColor?: string;
}

export function AgentOutputCard({
  output,
  accentColor = 'bg-primary',
}: AgentOutputCardProps) {
  return (
    <div className="group relative rounded-xl border border-border/60 bg-card shadow-sm transition-all hover:shadow-md hover:border-border">
      {/* Accent stripe */}
      <div
        className={`absolute left-0 top-3 bottom-3 w-0.5 rounded-full ${accentColor}`}
      />
      <div className="py-4 px-5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${accentColor}`} />
            {output.agent_name}
          </span>
          <time className="text-[10px] font-mono text-muted-foreground/60">
            {formatTime(output.created_at)}
          </time>
        </div>
        <div className="text-sm space-y-2 text-foreground/90">
          <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
            {output.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
