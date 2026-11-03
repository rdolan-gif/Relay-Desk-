import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { TicketMeta } from './types';

export function useTicketMeta() {
  return useQuery({
    queryKey: ['ticket-meta'],
    queryFn: () => api<TicketMeta>('GET', '/tickets/meta'),
    staleTime: 60_000,
  });
}

export const STATE_COLOURS: Record<string, string> = {
  open: 'teal',
  waiting: 'yellow',
  closed: 'gray',
  archived: 'dark',
};
export const PRIORITY_COLOURS: Record<string, string> = { low: 'gray', normal: 'blue', high: 'red' };
