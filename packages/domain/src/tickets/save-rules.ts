import { isResolved, type Priority, type TicketState } from './state.js';

export type StatusRequired = 'never' | 'on_close' | 'always';

/** The category settings that affect saving a ticket (spec 7.1). */
export interface CategoryRules {
  statusRequired: StatusRequired;
  multipleStatuses: boolean;
  checkChildOnClose: boolean;
  waitingRequiresReopen: boolean;
  allowedStatusIds: readonly string[];
}

export interface TicketFields {
  title: string;
  categoryId: string;
  state: TicketState;
  priority: Priority;
  userId: string | null;
  contactId: string | null;
  statusIds: string[];
  reopenAt: Date | null;
  parentId: string | null;
}

/** Where a save came from: rules differ for the ticket form, bulk edit and macros. */
export type SaveSource = 'form' | 'bulk' | 'macro' | 'api';

export interface SaveContext {
  source: SaveSource;
  actorId: string;
  /** True when the ticket's current User is a deactivated account. */
  ownerDeactivated: boolean;
  /** States of the ticket's child tickets. */
  childStates: readonly TicketState[];
  /** Did this save explicitly set the User field (to anything, including the same)? */
  userSetExplicitly: boolean;
  now: Date;
}

export interface SaveError {
  field: keyof TicketFields | 'children';
  code: string;
  message: string;
}

export type SaveResult = { ok: true; ticket: TicketFields } | { ok: false; errors: SaveError[] };

/**
 * Validates a ticket save and applies the automatic field rules (spec 6.3, 7.1):
 * - Closing or archiving from the form with no User sets User to the person saving
 *   (not from bulk edit; a macro that sets a user wins).
 * - A deactivated User is cleared unless the same save sets a user.
 * - Waiting needs a re-open time when the category requires it.
 * - Status required never / on close / on every save; one status unless multiple allowed;
 *   newly added statuses must be enabled for the category (existing ones may stay).
 * - With "check child tickets on close", closing is refused while a child is unresolved.
 */
export function applySaveRules(
  before: TicketFields | null,
  after: TicketFields,
  category: CategoryRules,
  ctx: SaveContext,
): SaveResult {
  const t: TicketFields = { ...after, statusIds: [...new Set(after.statusIds)] };
  const errors: SaveError[] = [];

  if (ctx.ownerDeactivated && !ctx.userSetExplicitly && before && t.userId === before.userId) {
    t.userId = null;
  }

  const becameResolved = isResolved(t.state) && (!before || !isResolved(before.state));
  if (becameResolved && t.userId === null && ctx.source === 'form') {
    t.userId = ctx.actorId;
  }

  if (!t.title.trim()) errors.push({ field: 'title', code: 'required', message: 'Title is required.' });

  if (t.state === 'waiting' && category.waitingRequiresReopen && !t.reopenAt) {
    errors.push({
      field: 'reopenAt',
      code: 'required',
      message: 'Set a re-open date when moving the ticket to Waiting.',
    });
  }
  if (
    t.reopenAt &&
    t.state === 'waiting' &&
    t.reopenAt <= ctx.now &&
    (!before || before.reopenAt?.getTime() !== t.reopenAt.getTime())
  ) {
    errors.push({ field: 'reopenAt', code: 'in_past', message: 'The re-open date must be in the future.' });
  }

  const added = t.statusIds.filter((s) => !before?.statusIds.includes(s));
  if (added.some((s) => !category.allowedStatusIds.includes(s))) {
    errors.push({ field: 'statusIds', code: 'not_allowed', message: 'That status is not available in this category.' });
  }
  if (!category.multipleStatuses && t.statusIds.length > 1) {
    errors.push({ field: 'statusIds', code: 'single_only', message: 'This category allows only one status.' });
  }
  const needsStatus =
    category.statusRequired === 'always' || (category.statusRequired === 'on_close' && becameResolved);
  if (needsStatus && t.statusIds.length === 0) {
    errors.push({ field: 'statusIds', code: 'required', message: 'Choose a status before saving.' });
  }

  if (becameResolved && category.checkChildOnClose && ctx.childStates.some((s) => !isResolved(s))) {
    errors.push({ field: 'children', code: 'open_children', message: 'Close or archive all child tickets first.' });
  }

  return errors.length ? { ok: false, errors } : { ok: true, ticket: t };
}

/** Deleting is refused while children are unresolved, when the category checks children. */
export function canDeleteTicket(
  category: Pick<CategoryRules, 'checkChildOnClose'>,
  childStates: readonly TicketState[],
): boolean {
  return !category.checkChildOnClose || childStates.every(isResolved);
}

/** Setting `parentId` must not create a cycle (a ticket cannot be its own ancestor). */
export function wouldCreateCycle(
  ticketId: string,
  newParentId: string | null,
  parentOf: (id: string) => string | null,
): boolean {
  let cur = newParentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === ticketId) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = parentOf(cur);
  }
  return false;
}

/** Tickets closed for at least `days` are due for auto-archive (spec 6.3, 7.1). */
export function isDueForAutoArchive(
  state: TicketState,
  closedAt: Date | null,
  days: number | null,
  now: Date,
): boolean {
  if (state !== 'closed' || !closedAt || days === null) return false;
  return now.getTime() - closedAt.getTime() >= days * 86_400_000;
}

/** Waiting or Closed tickets whose re-open time has passed reopen (spec 6.3). */
export function isDueForReopen(state: TicketState, reopenAt: Date | null, now: Date): boolean {
  return (state === 'waiting' || state === 'closed') && !!reopenAt && reopenAt.getTime() <= now.getTime();
}
