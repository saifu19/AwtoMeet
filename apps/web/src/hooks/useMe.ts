import { useQuery } from '@tanstack/react-query';
import type { MeRes } from '@meeting-app/shared';
import { api } from '@/lib/api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<MeRes>('/auth/me'),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
