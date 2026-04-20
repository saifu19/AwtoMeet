import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ArrowLeftIcon } from 'lucide-react';
import type { CreateAgentReq } from '@meeting-app/shared';
import { Button } from '@/components/ui/button';
import { AgentForm } from '@/features/agents/AgentForm';
import { useCreateAgent } from '@/features/agents/hooks';

export const Route = createFileRoute('/_auth/agents/new')({
  component: NewAgentPage,
});

function NewAgentPage() {
  const navigate = useNavigate();
  const createAgent = useCreateAgent();

  const handleSubmit = async (data: CreateAgentReq) => {
    try {
      const agent = await createAgent.mutateAsync(data);
      toast.success(`Agent "${agent.name}" created successfully`);
      navigate({ to: '/agents' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create agent');
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <Link to="/agents">
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground mb-6">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to agents
        </Button>
      </Link>
      <AgentForm
        onSubmit={handleSubmit}
        isSubmitting={createAgent.isPending}
        submitLabel="Create Agent"
      />
    </div>
  );
}
