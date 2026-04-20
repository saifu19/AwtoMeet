import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface MeetingAgent {
  id: string;
  name: string;
}

interface MeetingAgentsResponse {
  agents: MeetingAgent[];
}

export function useMeetingAgents(meetingId: string) {
  return useQuery({
    queryKey: ['meetings', meetingId, 'agents'],
    queryFn: () =>
      api<MeetingAgentsResponse>(`/meetings/${meetingId}/agents`).then(
        (r) => r.agents,
      ),
    enabled: !!meetingId,
    staleTime: 5 * 60 * 1000,
  });
}
