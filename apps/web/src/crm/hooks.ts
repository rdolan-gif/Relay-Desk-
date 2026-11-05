import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { CrmMeta, DirectoryUser } from './types';

export function useCrmMeta() {
  return useQuery({ queryKey: ['crm-meta'], queryFn: () => api<CrmMeta>('GET', '/crm/meta'), staleTime: 60_000 });
}

export function useUserDirectory() {
  return useQuery({
    queryKey: ['user-directory'],
    queryFn: () => api<DirectoryUser[]>('GET', '/directory/users'),
    staleTime: 60_000,
  });
}

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
