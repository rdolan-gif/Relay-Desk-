import type { Priority, TicketState } from '../tickets/state.js';
import { addWorkingMinutes, workingMinutesBetween, type TimeGroup } from './working-time.js';

/**
 * SLA rules (spec 8). An SLA gives, per key, a Response time (optional) and a Solution
 * time (required). The key is the ticket's priority, or — for an SLA based on a select
 * field such as Ricoman's "Enquiry type" (owner O-11) — that field's value.
 */
export type SlaUnit = 'hours' | 'minutes';

export interface SlaTarget {
  response: number | null;
  solution: number;
}

export interface SlaDefinition {
  unit: SlaUnit;
  /** null = targets are keyed by priority (low/normal/high). Otherwise a select custom field id. */
  basisFieldId: string | null;
  /** Keyed by priority, or by the field's option values plus OTHER_KEY for anything else. */
  targets: Record<string, SlaTarget>;
}

/** Target used when a field-based SLA meets an empty or unlisted value. */
export const SLA_OTHER_KEY = '_other';
export const PRIORITY_KEYS: Priority[] = ['low', 'normal', 'high'];

export interface TargetMinutes {
  response: number | null;
  solution: number;
}

/** The account's SLA wins over the category's; working hours always come from the category. */
export const chooseSla = <T>(accountSla: T | null | undefined, categorySla: T | null | undefined): T | null =>
  accountSla ?? categorySla ?? null;

/** The response and solution minutes that apply to a ticket, or null when the SLA has no target for it. */
export function slaTargets(
  sla: SlaDefinition,
  ticket: { priority: Priority; customFields: Record<string, unknown> },
): TargetMinutes | null {
  let key: string;
  if (sla.basisFieldId) {
    const v = ticket.customFields[sla.basisFieldId];
    key = typeof v === 'string' && v && sla.targets[v] ? v : SLA_OTHER_KEY;
  } else key = ticket.priority;
  const t = sla.targets[key];
  if (!t) return null;
  const factor = sla.unit === 'hours' ? 60 : 1;
  return { response: t.response === null ? null : t.response * factor, solution: t.solution * factor };
}

/** Problems with an SLA definition, for the settings form. */
export function validateSla(sla: SlaDefinition, fieldOptions?: string[]): string[] {
  const errors: string[] = [];
  const keys = sla.basisFieldId ? [...(fieldOptions ?? []), SLA_OTHER_KEY] : PRIORITY_KEYS;
  for (const key of keys) {
    const t = sla.targets[key];
    if (!t) {
      errors.push(`Set a Solution time for "${key === SLA_OTHER_KEY ? 'anything else' : key}".`);
      continue;
    }
    if (!(t.solution > 0)) errors.push(`The Solution time for "${key}" must be more than 0.`);
    if (t.response !== null && !(t.response > 0)) errors.push(`The Response time for "${key}" must be more than 0.`);
  }
  for (const key of Object.keys(sla.targets))
    if (!keys.includes(key as never))
      errors.push(`"${key}" is not a ${sla.basisFieldId ? 'value of the field' : 'priority'}.`);
  return errors;
}

const resolved = (s: TicketState) => s === 'closed' || s === 'archived';

/** What the stored SLA columns of a ticket hold. */
export interface SlaTicket {
  createdAt: Date;
  state: TicketState;
  firstAnswerAt: Date | null;
  closedAt: Date | null;
  /** When the ticket last entered Waiting (null when not Waiting). */
  waitingSince: Date | null;
  /** Working seconds spent in Waiting so far (spec 5: sla_paused_seconds). */
  pausedSeconds: number;
  /** A deadline set by a person; never recalculated. */
  deadlineManual: boolean;
  deadline: Date | null;
  noReplyNeeded: boolean;
  firstAnswerMet: boolean | null;
  solutionMet: boolean | null;
}

export interface SlaResult {
  firstAnswerDeadline: Date | null;
  deadline: Date | null;
  waitingSince: Date | null;
  pausedSeconds: number;
  firstAnswerMet: boolean | null;
  solutionMet: boolean | null;
}

/**
 * Recomputes a ticket's SLA columns from its stored facts. Idempotent, so it can run after
 * any change (priority, category, account, state, a reply) and from a periodic job.
 *
 * - Response + Solution: first answer due at created + Response; deadline at created +
 *   Response + Solution (all in working time).
 * - Waiting pauses the solution clock: on leaving Waiting the working time spent there is
 *   added to the deadline. The first-answer clock never pauses.
 * - Outcome flags are decided once and then frozen.
 */
export function computeSla(t: SlaTicket, targets: TargetMinutes | null, tg: TimeGroup | null, now: Date): SlaResult {
  let waitingSince = t.waitingSince;
  let pausedSeconds = t.pausedSeconds;
  if (t.state === 'waiting' && !waitingSince) waitingSince = now;
  if (t.state !== 'waiting' && waitingSince) {
    pausedSeconds += Math.round(workingMinutesBetween(waitingSince, now, tg) * 60);
    waitingSince = null;
  }

  const firstAnswerDeadline =
    targets && targets.response !== null ? addWorkingMinutes(t.createdAt, targets.response, tg) : null;
  let deadline: Date | null;
  if (t.deadlineManual) deadline = t.deadline;
  else if (targets)
    deadline = addWorkingMinutes(t.createdAt, (targets.response ?? 0) + targets.solution + pausedSeconds / 60, tg);
  else deadline = null;

  let firstAnswerMet = t.firstAnswerMet;
  if (firstAnswerMet === null && firstAnswerDeadline && !t.noReplyNeeded) {
    if (t.firstAnswerAt) firstAnswerMet = t.firstAnswerAt.getTime() <= firstAnswerDeadline.getTime();
    else if (now > firstAnswerDeadline && !resolved(t.state)) firstAnswerMet = false;
  }

  let solutionMet = t.solutionMet;
  if (solutionMet === null && deadline) {
    if (resolved(t.state)) solutionMet = (t.closedAt ?? now).getTime() <= deadline.getTime();
    else if (t.state === 'open' && now > deadline) solutionMet = false;
  }

  return { firstAnswerDeadline, deadline, waitingSince, pausedSeconds, firstAnswerMet, solutionMet };
}

export type SlaIconStatus = 'counting' | 'paused' | 'breached' | 'met' | 'missed';

export interface SlaIndicator {
  /** hand = first answer, stopwatch = solution (spec 6.2, "SLA icons"). */
  kind: 'response' | 'solution';
  status: SlaIconStatus;
  due: Date;
  /** Working minutes left (negative when breached); null when the outcome is decided. */
  minutesLeft: number | null;
}

/**
 * What the SLA icon shows. Black and counting = time left; black and paused = Waiting;
 * red and counting negative = breached and unresolved; green still = met; red still = missed.
 */
export function slaIndicator(
  t: {
    state: TicketState;
    firstAnswerDeadline: Date | null;
    deadline: Date | null;
    firstAnswerAt: Date | null;
    firstAnswerMet: boolean | null;
    solutionMet: boolean | null;
    noReplyNeeded: boolean;
    waitingSince: Date | null;
  },
  tg: TimeGroup | null,
  now: Date,
): SlaIndicator | null {
  const left = (due: Date) =>
    now <= due ? Math.round(workingMinutesBetween(now, due, tg)) : -Math.round(workingMinutesBetween(due, now, tg));
  if (
    t.firstAnswerDeadline &&
    t.firstAnswerMet === null &&
    !t.firstAnswerAt &&
    !t.noReplyNeeded &&
    !resolved(t.state)
  ) {
    const m = left(t.firstAnswerDeadline);
    return { kind: 'response', status: m >= 0 ? 'counting' : 'breached', due: t.firstAnswerDeadline, minutesLeft: m };
  }
  if (!t.deadline) return null;
  const due = t.deadline;
  if (t.solutionMet === true) return { kind: 'solution', status: 'met', due, minutesLeft: null };
  if (t.solutionMet === false)
    return resolved(t.state)
      ? { kind: 'solution', status: 'missed', due, minutesLeft: null }
      : { kind: 'solution', status: 'breached', due, minutesLeft: left(due) };
  if (resolved(t.state)) return { kind: 'solution', status: 'met', due, minutesLeft: null };
  if (t.state === 'waiting') {
    const from = t.waitingSince ?? now;
    return {
      kind: 'solution',
      status: 'paused',
      due,
      minutesLeft: from <= due ? Math.round(workingMinutesBetween(from, due, tg)) : 0,
    };
  }
  const m = left(due);
  return { kind: 'solution', status: m >= 0 ? 'counting' : 'breached', due, minutesLeft: m };
}
