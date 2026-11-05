import type { TicketState } from '../tickets/state.js';

export interface ThreadCandidate {
  ticketId: number;
  state: TicketState;
  lastActivityAt: Date;
}

export type ThreadDecision =
  { action: 'append'; ticketId: number; suggested: number[] } | { action: 'new_ticket'; suggested: number[] };

/**
 * Threading (spec 11.2 steps 3–4). Header matches (In-Reply-To / References) come
 * first when header threading is on; otherwise, or with none, the "[#123]" subject
 * token. Exactly one non-archived match → append. Several → append to the most
 * recently active and suggest the others. Matched ticket Archived, or none → new ticket.
 */
export function decideThread(args: {
  headerThreading: boolean;
  headerMatches: ThreadCandidate[];
  subjectMatch: ThreadCandidate | null;
}): ThreadDecision {
  const byId = new Map<number, ThreadCandidate>();
  if (args.headerThreading) for (const c of args.headerMatches) byId.set(c.ticketId, c);
  if (byId.size === 0 && args.subjectMatch) byId.set(args.subjectMatch.ticketId, args.subjectMatch);
  const all = [...byId.values()].sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  if (all.length === 0) return { action: 'new_ticket', suggested: [] };
  const open = all.filter((c) => c.state !== 'archived');
  if (open.length === 0) return { action: 'new_ticket', suggested: [] };
  const [target, ...others] = open;
  return { action: 'append', ticketId: target!.ticketId, suggested: others.map((c) => c.ticketId) };
}

/** Contact matching (spec 12.3): one match → it; several → the most recently active. */
export function pickContact<T extends { id: string; updatedAt: Date }>(
  matches: readonly T[],
): { contact: T | null; others: T[] } {
  if (matches.length === 0) return { contact: null, others: [] };
  const sorted = [...matches].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return { contact: sorted[0]!, others: sorted.slice(1) };
}
