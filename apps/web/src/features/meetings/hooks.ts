import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  MeetingSchema,
  CreateMeetingReq,
  UpdateMeetingReq,
  JoinMeetingRes,
  GuestJoinReq,
  MeetingSummaryResponseSchema,
  TranscriptMessageSchema,
} from '@meeting-app/shared';
import { api } from '@/lib/api';

export function useMeetings(status?: string) {
  return useQuery({
    queryKey: ['meetings', { status }],
    queryFn: async () => {
      const qs = status ? `?status=${status}` : '';
      const res = await api<{ data: MeetingSchema[] }>(`/meetings${qs}`);
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useMeeting(id: string) {
  return useQuery({
    queryKey: ['meetings', id],
    queryFn: () => api<MeetingSchema>(`/meetings/${id}`),
    enabled: !!id,
  });
}

export function useCreateMeeting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateMeetingReq) =>
      api<MeetingSchema>('/meetings', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
    },
  });
}

export function useUpdateMeeting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateMeetingReq }) =>
      api<MeetingSchema>(`/meetings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
      queryClient.invalidateQueries({ queryKey: ['meetings', variables.id] });
    },
  });
}

export function useDeleteMeeting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/meetings/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
    },
  });
}

export function useJoinMeeting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api<JoinMeetingRes>(`/meetings/${id}/join`, { method: 'POST' }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['meetings', id] });
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
    },
  });
}

export function useLeaveMeeting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/meetings/${id}/leave`, { method: 'POST' }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['meetings', id] });
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
    },
  });
}

export function useGuestJoinMeeting() {
  return useMutation({
    mutationFn: ({ id, display_name }: { id: string; display_name: string }) =>
      api<JoinMeetingRes>(`/meetings/${id}/join-guest`, {
        method: 'POST',
        body: JSON.stringify({ display_name }),
      }),
  });
}

export function useMeetingSummary(meetingId: string) {
  return useQuery({
    queryKey: ['meetings', meetingId, 'summary'],
    queryFn: () =>
      api<MeetingSummaryResponseSchema>(`/meetings/${meetingId}/summary`),
    enabled: !!meetingId,
    retry: false,
  });
}

export function useTranscript(meetingId: string) {
  return useQuery({
    queryKey: ['meetings', meetingId, 'transcript'],
    queryFn: async () => {
      const res = await api<{ messages: TranscriptMessageSchema[] }>(
        `/meetings/${meetingId}/transcript`,
      );
      return res.messages;
    },
    enabled: !!meetingId,
  });
}
