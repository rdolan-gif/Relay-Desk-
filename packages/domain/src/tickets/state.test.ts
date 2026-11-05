import { describe, expect, it } from 'vitest';
import { automaticState, canPostExternalComment, inboundEmailTarget, resolveState, type TicketState } from './state.js';

const owner = 'owner-1';
const ctx = (state: TicketState, userId: string | null = owner) => ({ state, userId });

describe('spec 6.3 table 1: what a customer email does in each state', () => {
  it('Open: the email is appended and the ticket stays Open', () => {
    expect(inboundEmailTarget('open')).toBe('append');
    expect(automaticState(ctx('open'), { type: 'inbound_customer_email' })).toBeNull();
  });
  it('Waiting: the email is appended and the ticket reopens', () => {
    expect(inboundEmailTarget('waiting')).toBe('append');
    expect(automaticState(ctx('waiting'), { type: 'inbound_customer_email' })).toBe('open');
  });
  it('Closed: the email is appended and the ticket reopens', () => {
    expect(inboundEmailTarget('closed')).toBe('append');
    expect(automaticState(ctx('closed'), { type: 'inbound_customer_email' })).toBe('open');
  });
  it('Archived: a new ticket is created instead', () => {
    expect(inboundEmailTarget('archived')).toBe('new_ticket');
    expect(automaticState(ctx('archived'), { type: 'inbound_customer_email' })).toBeNull();
  });
  it('no matching ticket: a new ticket is created', () => {
    expect(inboundEmailTarget(null)).toBe('new_ticket');
  });
});

describe('spec 6.3 table 2: automatic reopen rules', () => {
  it('inbound customer email reopens Waiting: yes', () => {
    expect(automaticState(ctx('waiting'), { type: 'inbound_customer_email' })).toBe('open');
  });
  it('inbound customer email reopens Closed: yes', () => {
    expect(automaticState(ctx('closed'), { type: 'inbound_customer_email' })).toBe('open');
  });
  it('new still-in-progress activity reopens Waiting: no', () => {
    expect(
      automaticState(ctx('waiting'), { type: 'activity_attached', inProgress: true, createdFromTicket: false }),
    ).toBeNull();
  });
  it('new still-in-progress activity reopens Closed: yes', () => {
    expect(
      automaticState(ctx('closed'), { type: 'activity_attached', inProgress: true, createdFromTicket: false }),
    ).toBe('open');
  });
  it('external comment from the portal reopens Waiting: yes', () => {
    expect(automaticState(ctx('waiting'), { type: 'external_comment' })).toBe('open');
  });
  it('external comment from the portal reopens Closed: yes', () => {
    expect(automaticState(ctx('closed'), { type: 'external_comment' })).toBe('open');
  });
  it("internal comment by someone other than the ticket's User reopens Waiting: yes", () => {
    expect(automaticState(ctx('waiting'), { type: 'internal_comment', authorId: 'someone-else' })).toBe('open');
  });
  it("internal comment by someone other than the ticket's User reopens Closed: yes", () => {
    expect(automaticState(ctx('closed'), { type: 'internal_comment', authorId: 'someone-else' })).toBe('open');
  });
  it('re-open date/time reached reopens Waiting: yes', () => {
    expect(automaticState(ctx('waiting'), { type: 'reopen_time_reached' })).toBe('open');
  });
  it('re-open date/time reached reopens Closed: yes', () => {
    expect(automaticState(ctx('closed'), { type: 'reopen_time_reached' })).toBe('open');
  });
});

describe('spec 6.3: no automatic change', () => {
  it('a comment on your own ticket', () => {
    expect(automaticState(ctx('closed'), { type: 'internal_comment', authorId: owner })).toBeNull();
    expect(automaticState(ctx('waiting'), { type: 'internal_comment', authorId: owner })).toBeNull();
  });
  it('a comment on an unassigned ticket', () => {
    expect(automaticState(ctx('closed', null), { type: 'internal_comment', authorId: 'anyone' })).toBeNull();
  });
  it('creating a non-comment activity from a Waiting ticket', () => {
    expect(
      automaticState(ctx('waiting'), { type: 'activity_attached', inProgress: true, createdFromTicket: true }),
    ).toBeNull();
  });
  it('attaching an already-finished activity', () => {
    expect(
      automaticState(ctx('closed'), { type: 'activity_attached', inProgress: false, createdFromTicket: false }),
    ).toBeNull();
    expect(
      automaticState(ctx('waiting'), { type: 'activity_attached', inProgress: false, createdFromTicket: false }),
    ).toBeNull();
  });
  it('moving activities between tickets', () => {
    for (const s of ['open', 'waiting', 'closed', 'archived'] as const)
      expect(automaticState(ctx(s), { type: 'activity_moved' })).toBeNull();
  });
  it('anything on an Archived ticket', () => {
    const events = [
      { type: 'inbound_customer_email' },
      { type: 'external_comment' },
      { type: 'internal_comment', authorId: 'x' },
      { type: 'reopen_time_reached' },
      { type: 'activity_attached', inProgress: true, createdFromTicket: false },
    ] as const;
    for (const e of events) expect(automaticState(ctx('archived'), e)).toBeNull();
  });
  it('the portal disables external comments on Archived tickets', () => {
    expect(canPostExternalComment('archived', true)).toBe(false);
    expect(canPostExternalComment('closed', true)).toBe(true);
    expect(canPostExternalComment('open', false)).toBe(false);
  });
  it('a state chosen manually in the same save always wins over automation', () => {
    expect(resolveState('closed', 'closed', 'open')).toBe('open'); // unchanged manual value is not a choice
    expect(resolveState('waiting', 'closed', 'open')).toBe('closed');
    expect(resolveState('waiting', undefined, 'open')).toBe('open');
    expect(resolveState('waiting', undefined, null)).toBe('waiting');
  });
});
