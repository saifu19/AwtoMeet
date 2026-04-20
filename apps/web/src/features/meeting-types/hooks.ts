import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  MeetingTypeSchema,
  CreateMeetingTypeReq,
  UpdateMeetingTypeReq,
} from '@meeting-app/shared';
import { api } from '@/lib/api';

export function useMeetingTypes() {
  return useQuery({
    queryKey: ['meeting-types'],
    queryFn: async () => {
      const res = await api<{ data: MeetingTypeSchema[] }>('/meeting-types');
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useMeetingType(id: string) {
  return useQuery({
    queryKey: ['meeting-types', id],
    queryFn: () => api<MeetingTypeSchema>(`/meeting-types/${id}`),
    enabled: !!id,
  });
}

export function useCreateMeetingType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateMeetingTypeReq) =>
      api<MeetingTypeSchema>('/meeting-types', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meeting-types'] });
    },
  });
}

export function useUpdateMeetingType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateMeetingTypeReq }) =>
      api<MeetingTypeSchema>(`/meeting-types/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['meeting-types'] });
      queryClient.invalidateQueries({
        queryKey: ['meeting-types', variables.id],
      });
    },
  });
}

export function useDeleteMeetingType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/meeting-types/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meeting-types'] });
    },
  });
}
