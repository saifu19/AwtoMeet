import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ArrowLeftIcon } from 'lucide-react';
import type { CreateAgentReq } from '@meeting-app/shared';
import { Button } from '@/components/ui/button';
import { AgentForm } from '@/features/agents/AgentForm';
import { useAgent, useUpdateAgent } from '@/features/agents/hooks';

export const Route = createFileRoute('/_auth/agents/$id')({
  component: EditAgentPage,
});

function EditAgentPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data: agent, isLoading } = useAgent(id);
  const updateAgent = useUpdateAgent();

  const handleSubmit = async (data: CreateAgentReq) => {
    try {
      const updated = await updateAgent.mutateAsync({ id, data });
      toast.success(`Agent "${updated.name}" updated successfully`);
      navigate({ to: '/agents' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update agent');
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

  if (!agent) {
    return (
      <div className="mx-auto max-w-5xl p-6 lg:p-8">
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-muted-foreground mb-4">Agent not found</p>
          <Link to="/agents">
            <Button variant="outline">Back to agents</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <Link to="/agents">
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground mb-6">
          <ArrowLeftIcon className="h-4 w-4" />
          Back to agents
        </Button>
      </Link>
      <AgentForm
        defaultValues={{
          name: agent.name,
          system_prompt: agent.system_prompt,
          provider: agent.provider,
          model: agent.model,
        }}
        onSubmit={handleSubmit}
        isSubmitting={updateAgent.isPending}
        submitLabel="Save Changes"
      />
    </div>
  );
}
