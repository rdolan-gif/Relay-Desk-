/** System lifecycle states (spec 3, 6.3). */
export const TICKET_STATES = ['open', 'waiting', 'closed', 'archived'] as const;
export type TicketState = (typeof TICKET_STATES)[number];

export const PRIORITIES = ['low', 'normal', 'high'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Something that happened to a ticket which may change its state automatically. */
export type TicketEvent =
  /** A customer's email was appended to the ticket (Phase 3). */
  | { type: 'inbound_customer_email' }
  /**
   * An activity was attached. `inProgress` = still ongoing (e.g. a live call or chat);
   * `createdFromTicket` = an agent started it from this ticket (e.g. a reply).
   */
  | { type: 'activity_attached'; inProgress: boolean; createdFromTicket: boolean }
  /** An external user posted an external comment in the portal (Phase 7). */
  | { type: 'external_comment' }
  /** An internal comment was added by `authorId`. */
  | { type: 'internal_comment'; authorId: string }
  /** The ticket's re-open date/time has been reached. */
  | { type: 'reopen_time_reached' }
  /** An activity was moved onto or off this ticket. */
  | { type: 'activity_moved' };

export interface StateContext {
  state: TicketState;
  /** The ticket's User (owner), if any. */
  userId: string | null;
}

/**
 * Automatic reopen rules (spec 6.3). Returns 'open' when the event reopens the ticket,
 * or null for no automatic change.
 *
 * | Event                                   | Waiting | Closed |
 * | Inbound customer email                  | reopen  | reopen |
 * | New, still-in-progress activity         | -       | reopen |
 * | External comment from the portal        | reopen  | reopen |
 * | Internal comment by someone not the User| reopen  | reopen |
 * | Re-open date/time reached               | reopen  | reopen |
 *
 * Never: on Archived tickets; comments on your own or an unassigned ticket; creating a
 * non-comment activity from a Waiting ticket; attaching a finished activity; moving
 * activities.
 */
export function automaticState(ctx: StateContext, event: TicketEvent): 'open' | null {
  if (ctx.state === 'archived' || ctx.state === 'open') return null;
  const waiting = ctx.state === 'waiting';
  switch (event.type) {
    case 'inbound_customer_email':
    case 'external_comment':
    case 'reopen_time_reached':
      return 'open';
    case 'internal_comment':
      if (ctx.userId === null || ctx.userId === event.authorId) return null;
      return 'open';
    case 'activity_attached':
      if (!event.inProgress) return null;
      if (waiting) return null;
      return 'open';
    case 'activity_moved':
      return null;
  }
}

/** A state chosen manually in the same save always wins over automation (spec 6.3). */
export function resolveState(
  current: TicketState,
  manual: TicketState | undefined,
  automatic: 'open' | null,
): TicketState {
  if (manual !== undefined && manual !== current) return manual;
  return automatic ?? current;
}

/**
 * Where an inbound customer email goes (spec 6.3, 11.2): appended to the matched ticket,
 * unless it is Archived, in which case a new ticket is created instead.
 */
export function inboundEmailTarget(matchedState: TicketState | null): 'append' | 'new_ticket' {
  return matchedState === null || matchedState === 'archived' ? 'new_ticket' : 'append';
}

/** The portal disables external comments on Archived tickets (spec 6.3, 16). */
export function canPostExternalComment(state: TicketState, categoryAllowsExternal: boolean): boolean {
  return categoryAllowsExternal && state !== 'archived';
}

export const isResolved = (s: TicketState) => s === 'closed' || s === 'archived';
