import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  InviteSchema,
  CreateInviteReq,
  UpdateInviteReq,
  AcceptInviteRes,
} from '@meeting-app/shared';

// Pending invite with meeting info (returned by GET /invites/pending)
export interface PendingInvite extends InviteSchema {
  meeting_title: string;
  meeting_status: string;
  meeting_scheduled_at: string | null;
}
import { api } from '@/lib/api';

export function useInvites(meetingId: string) {
  return useQuery({
    queryKey: ['meetings', meetingId, 'invites'],
    queryFn: async () => {
      const res = await api<{ data: InviteSchema[] }>(
        `/meetings/${meetingId}/invites`,
      );
      return res.data;
    },
    enabled: !!meetingId,
    staleTime: 30_000,
  });
}

export function useCreateInvite(meetingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateInviteReq) =>
      api<InviteSchema>(`/meetings/${meetingId}/invites`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['meetings', meetingId, 'invites'],
      });
    },
  });
}

export function useUpdateInvite(meetingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      inviteId,
      data,
    }: {
      inviteId: string;
      data: UpdateInviteReq;
    }) =>
      api<InviteSchema>(`/meetings/${meetingId}/invites/${inviteId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['meetings', meetingId, 'invites'],
      });
    },
  });
}

export function useDeleteInvite(meetingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (inviteId: string) =>
      api<void>(`/meetings/${meetingId}/invites/${inviteId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['meetings', meetingId, 'invites'],
      });
    },
  });
}

export function usePendingInvites() {
  return useQuery({
    queryKey: ['invites', 'pending'],
    queryFn: async () => {
      const res = await api<{ data: PendingInvite[] }>('/invites/pending');
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useAcceptInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (token: string) =>
      api<AcceptInviteRes>(`/invites/${token}/accept`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invites', 'pending'] });
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
    },
  });
}
