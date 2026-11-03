import { describe, expect, it } from 'vitest';
import {
  applySaveRules,
  canDeleteTicket,
  isDueForAutoArchive,
  isDueForReopen,
  wouldCreateCycle,
  type CategoryRules,
  type SaveContext,
  type TicketFields,
} from './save-rules.js';
import { canCreateInCategory, canSeeCategory, visibleCategoryIds } from './rights.js';
import { followersToAdd, newMentions } from './mentions.js';

const now = new Date('2026-11-04T10:00:00Z');
const cat: CategoryRules = {
  statusRequired: 'never',
  multipleStatuses: false,
  checkChildOnClose: false,
  waitingRequiresReopen: false,
  allowedStatusIds: ['s1', 's2'],
};
const base: TicketFields = {
  title: 'T',
  categoryId: 'c',
  state: 'open',
  priority: 'normal',
  userId: null,
  contactId: null,
  statusIds: [],
  reopenAt: null,
  parentId: null,
};
const ctx = (o: Partial<SaveContext> = {}): SaveContext => ({
  source: 'form',
  actorId: 'me',
  ownerDeactivated: false,
  childStates: [],
  userSetExplicitly: false,
  now,
  ...o,
});

describe('auto-fill user on close (spec 6.3)', () => {
  it('when a ticket with no User is closed from the ticket form, User is set to the person saving', () => {
    const r = applySaveRules(base, { ...base, state: 'closed' }, cat, ctx());
    expect(r).toMatchObject({ ok: true, ticket: { userId: 'me' } });
  });
  it('the same applies when archiving from the form', () => {
    expect(applySaveRules(base, { ...base, state: 'archived' }, cat, ctx())).toMatchObject({
      ok: true,
      ticket: { userId: 'me' },
    });
  });
  it('bulk edit does not auto-fill the User', () => {
    expect(applySaveRules(base, { ...base, state: 'closed' }, cat, ctx({ source: 'bulk' }))).toMatchObject({
      ok: true,
      ticket: { userId: null },
    });
  });
  it('a macro that sets a different user wins', () => {
    expect(
      applySaveRules(
        base,
        { ...base, state: 'closed', userId: 'other' },
        cat,
        ctx({ source: 'macro', userSetExplicitly: true }),
      ),
    ).toMatchObject({
      ok: true,
      ticket: { userId: 'other' },
    });
  });
  it('an existing User is kept', () => {
    expect(
      applySaveRules({ ...base, userId: 'x' }, { ...base, userId: 'x', state: 'closed' }, cat, ctx()),
    ).toMatchObject({ ok: true, ticket: { userId: 'x' } });
  });
  it('re-saving an already-closed ticket does not auto-fill', () => {
    const closed = { ...base, state: 'closed' as const };
    expect(applySaveRules(closed, closed, cat, ctx())).toMatchObject({ ok: true, ticket: { userId: null } });
  });
});

describe('deactivated owner (spec 4, 6.3)', () => {
  it('when the User is deactivated and the save sets no other user, User is cleared', () => {
    const t = { ...base, userId: 'gone' };
    expect(applySaveRules(t, t, cat, ctx({ ownerDeactivated: true }))).toMatchObject({
      ok: true,
      ticket: { userId: null },
    });
  });
  it('when the same save sets another user, that user is kept', () => {
    const t = { ...base, userId: 'gone' };
    expect(
      applySaveRules(t, { ...t, userId: 'new' }, cat, ctx({ ownerDeactivated: true, userSetExplicitly: true })),
    ).toMatchObject({
      ok: true,
      ticket: { userId: 'new' },
    });
  });
});

describe('category save rules (spec 6.3, 7.1)', () => {
  it('when saving to Waiting in a category that requires it, a re-open time is mandatory', () => {
    const c = { ...cat, waitingRequiresReopen: true };
    expect(applySaveRules(base, { ...base, state: 'waiting' }, c, ctx())).toMatchObject({
      ok: false,
      errors: [{ field: 'reopenAt', code: 'required' }],
    });
    expect(
      applySaveRules(base, { ...base, state: 'waiting', reopenAt: new Date('2026-11-05T09:00:00Z') }, c, ctx()).ok,
    ).toBe(true);
  });
  it('a new re-open time on a Waiting ticket must be in the future', () => {
    expect(
      applySaveRules(base, { ...base, state: 'waiting', reopenAt: new Date('2026-11-01T00:00:00Z') }, cat, ctx()),
    ).toMatchObject({ ok: false });
  });
  it('when closing in a category with status required on close, a status is mandatory', () => {
    const c = { ...cat, statusRequired: 'on_close' as const };
    expect(applySaveRules(base, { ...base, state: 'closed' }, c, ctx())).toMatchObject({
      ok: false,
      errors: [{ field: 'statusIds', code: 'required' }],
    });
    expect(applySaveRules(base, { ...base, state: 'closed', statusIds: ['s1'] }, c, ctx()).ok).toBe(true);
    expect(applySaveRules(base, { ...base, title: 'x' }, c, ctx()).ok).toBe(true);
  });
  it('with status required always, every save needs a status', () => {
    expect(applySaveRules(base, base, { ...cat, statusRequired: 'always' }, ctx()).ok).toBe(false);
  });
  it('only one status unless the category allows multiple', () => {
    expect(applySaveRules(base, { ...base, statusIds: ['s1', 's2'] }, cat, ctx()).ok).toBe(false);
    expect(
      applySaveRules(base, { ...base, statusIds: ['s1', 's2'] }, { ...cat, multipleStatuses: true }, ctx()).ok,
    ).toBe(true);
  });
  it('a newly added status must be enabled for the category; a status removed from the category stays on existing tickets', () => {
    expect(applySaveRules(base, { ...base, statusIds: ['zz'] }, cat, ctx()).ok).toBe(false);
    const legacy = { ...base, statusIds: ['zz'] };
    expect(applySaveRules(legacy, { ...legacy, title: 'renamed' }, cat, ctx()).ok).toBe(true);
  });
  it('when closing with "check child tickets on close", any unresolved child blocks it', () => {
    const c = { ...cat, checkChildOnClose: true };
    expect(
      applySaveRules(base, { ...base, state: 'closed' }, c, ctx({ childStates: ['closed', 'open'] })),
    ).toMatchObject({
      ok: false,
      errors: [{ field: 'children', code: 'open_children' }],
    });
    expect(applySaveRules(base, { ...base, state: 'closed' }, c, ctx({ childStates: ['closed', 'archived'] })).ok).toBe(
      true,
    );
    expect(canDeleteTicket(c, ['waiting'])).toBe(false);
    expect(canDeleteTicket(cat, ['waiting'])).toBe(true);
  });
  it('a title is required', () => {
    expect(applySaveRules(base, { ...base, title: ' ' }, cat, ctx()).ok).toBe(false);
  });
});

describe('scheduled rules (spec 6.3)', () => {
  it('a Closed ticket archives after N days when the category says so', () => {
    expect(isDueForAutoArchive('closed', new Date('2026-10-28T10:00:00Z'), 7, now)).toBe(true);
    expect(isDueForAutoArchive('closed', new Date('2026-10-29T10:00:01Z'), 7, now)).toBe(false);
    expect(isDueForAutoArchive('closed', new Date('2026-01-01'), null, now)).toBe(false);
    expect(isDueForAutoArchive('open', new Date('2026-01-01'), 1, now)).toBe(false);
  });
  it('Waiting and Closed tickets reopen when their re-open time passes', () => {
    expect(isDueForReopen('waiting', new Date('2026-11-04T09:59:00Z'), now)).toBe(true);
    expect(isDueForReopen('closed', new Date('2026-11-04T09:59:00Z'), now)).toBe(true);
    expect(isDueForReopen('archived', new Date('2026-11-04T09:59:00Z'), now)).toBe(false);
    expect(isDueForReopen('waiting', new Date('2026-11-04T10:01:00Z'), now)).toBe(false);
  });
});

describe('parent/child (spec 6.4)', () => {
  const parents: Record<string, string | null> = { a: null, b: 'a', c: 'b' };
  it('a ticket cannot become its own ancestor', () => {
    expect(wouldCreateCycle('a', 'c', (id) => parents[id] ?? null)).toBe(true);
    expect(wouldCreateCycle('a', 'a', (id) => parents[id] ?? null)).toBe(true);
    expect(wouldCreateCycle('c', 'a', (id) => parents[id] ?? null)).toBe(false);
  });
});

describe('category rights (spec 4)', () => {
  const rights = {
    categories: [
      { categoryId: 'support', access: true, distributionLimit: 5 },
      { categoryId: 'intake', access: false, distributionLimit: null },
    ],
    ticketViews: [],
  };
  it('with Access = No the user can create a ticket in the category but not see it', () => {
    expect(canCreateInCategory(rights, 'intake')).toBe(true);
    expect(canSeeCategory(rights, 'intake')).toBe(false);
  });
  it('with Access = Yes the user sees the category; others are invisible', () => {
    expect(canSeeCategory(rights, 'support')).toBe(true);
    expect(canSeeCategory(rights, 'billing')).toBe(false);
    expect(canCreateInCategory(rights, 'billing')).toBe(false);
    expect(visibleCategoryIds(rights)).toEqual(['support']);
  });
});

describe('followers and mentions (spec 13)', () => {
  it('the comment author and mentioned users become followers; external users never do', () => {
    expect(
      followersToAdd({
        existing: ['a'],
        authorId: 'b',
        mentionedIds: ['a', 'c', 'ext'],
        isInternalUser: (id) => id !== 'ext',
      }),
    ).toEqual(['b', 'c']);
  });
  it('a new @mention added during an edit is detected', () => {
    expect(newMentions(['a'], ['a', 'b', 'b'])).toEqual(['b']);
  });
});
