import type { TicketState } from '../tickets/state.js';
import { localParts, zonedTime } from '../sla/working-time.js';

/**
 * Reporting maths (spec 17). Pure functions over ticket facts and state-change events so
 * every figure on the Reporting page can be checked by hand.
 */
export interface StateEvent {
  at: Date;
  /** The state after the change. */
  state: TicketState;
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** "Met %": tickets where the flag is true ÷ tickets where it was decided (null = not decided). */
export function percentMet(flags: (boolean | null)[]) {
  const decided = flags.filter((f) => f !== null).length;
  const met = flags.filter((f) => f === true).length;
  return { met, decided, percent: decided ? Math.round((met / decided) * 1000) / 10 : null };
}

const RESOLVED = new Set<TicketState>(['closed', 'archived']);

/** Reopened at least once: went from Closed/Archived back to Open or Waiting. */
export function wasReopened(events: StateEvent[], initial: TicketState = 'open'): boolean {
  let prev = initial;
  for (const e of [...events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (RESOLVED.has(prev) && !RESOLVED.has(e.state)) return true;
    prev = e.state;
  }
  return false;
}

/** When the ticket was first closed (or archived), from its state changes. */
export function firstResolvedAt(events: StateEvent[], initial: TicketState = 'open', createdAt?: Date): Date | null {
  if (RESOLVED.has(initial) && createdAt) return createdAt;
  const e = [...events].sort((a, b) => a.at.getTime() - b.at.getTime()).find((x) => RESOLVED.has(x.state));
  return e?.at ?? null;
}

/** The state at an instant, replaying changes from the creation state. */
export function ticketStateAt(at: Date, events: StateEvent[], initial: TicketState = 'open'): TicketState {
  let s = initial;
  for (const e of [...events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (e.at.getTime() > at.getTime()) break;
    s = e.state;
  }
  return s;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar days from..to inclusive ("YYYY-MM-DD"). */
export function dayKeys(from: Date, to: Date, tz: string): string[] {
  const a = localParts(from, tz);
  const b = localParts(to, tz);
  const out: string[] = [];
  let d = new Date(Date.UTC(a.year, a.month - 1, a.day));
  const end = Date.UTC(b.year, b.month - 1, b.day);
  for (let i = 0; d.getTime() <= end && i < 3700; i++) {
    out.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
    d = new Date(d.getTime() + 86_400_000);
  }
  return out;
}

/** The instant a local day ends (start of the next day). */
export function endOfDay(day: string, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return new Date(zonedTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, tz));
}

export const dayOf = (at: Date, tz: string) => {
  const p = localParts(at, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

/** Backlog: tickets Open or Waiting at the end of each day (spec 17). */
export function backlogByDay(
  tickets: { createdAt: Date; deletedAt?: Date | null; initial?: TicketState; events: StateEvent[] }[],
  days: string[],
  tz: string,
): { day: string; count: number }[] {
  return days.map((day) => {
    const end = endOfDay(day, tz);
    let count = 0;
    for (const t of tickets) {
      if (t.createdAt.getTime() >= end.getTime()) continue;
      if (t.deletedAt && t.deletedAt.getTime() < end.getTime()) continue;
      const s = ticketStateAt(new Date(end.getTime() - 1), t.events, t.initial ?? 'open');
      if (s === 'open' || s === 'waiting') count++;
    }
    return { day, count };
  });
}

/** Counts per local day for a list of instants. */
export function countByDay(instants: Date[], days: string[], tz: string): { day: string; count: number }[] {
  const counts = new Map(days.map((d) => [d, 0]));
  for (const at of instants) {
    const k = dayOf(at, tz);
    if (counts.has(k)) counts.set(k, counts.get(k)! + 1);
  }
  return days.map((day) => ({ day, count: counts.get(day)! }));
}

/** Inbound volume by weekday (0 = Monday) and hour, in the user's timezone. */
export function heatmap(instants: Date[], tz: string): number[][] {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const at of instants) {
    const p = localParts(at, tz);
    const wd = (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7;
    grid[wd]![p.hour]! += 1;
  }
  return grid;
}
