import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  applyMacroAction,
  ME,
  planNotifications,
  renderMacroUrl,
  runMacro,
  slaNotice,
  validateMacro,
  zonedTime,
  type EmailRule,
  type MacroForm,
  type TimeGroup,
} from './index.js';

const at = (y: number, m: number, d: number, h: number, mi = 0) =>
  new Date(zonedTime(y, m, d, h * 60 + mi, 'Europe/London'));
const all = () => true;
const rule = (userId: string, over: Partial<EmailRule> = {}): EmailRule => ({
  userId,
  owner: false,
  followed: false,
  new: false,
  activity: false,
  ...over,
});

describe('notifications (spec 13)', () => {
  it('assignment notifies the new owner in-app, and by email when their Owner rule is on', () => {
    const p = planNotifications(
      { type: 'assigned', actorId: 'boss', ownerId: 'heather' },
      { followerIds: [], rules: [rule('heather', { owner: true })], canSee: all },
    );
    expect(p.inApp).toEqual([{ userId: 'heather', kind: 'assigned' }]);
    expect(p.email).toEqual([{ userId: 'heather', kind: 'owner' }]);
  });

  it('no notification is ever sent to the user who caused the event', () => {
    const p = planNotifications(
      { type: 'activity', actorId: 'ryan', ownerId: 'ryan', mentionedIds: ['ryan'] },
      { followerIds: ['ryan'], rules: [rule('ryan', { owner: true, followed: true, activity: true })], canSee: all },
    );
    expect(p).toEqual({ inApp: [], email: [] });
  });

  it('new activity notifies the owner and followers in-app; a mention wins over "activity" and reaches non-followers', () => {
    const p = planNotifications(
      { type: 'activity', actorId: 'ryan', ownerId: 'heather', mentionedIds: ['thierry', 'heather'] },
      { followerIds: ['heather', 'richard'], rules: [], canSee: all },
    );
    expect(p.inApp).toEqual([
      { userId: 'thierry', kind: 'mention' },
      { userId: 'heather', kind: 'mention' },
      { userId: 'richard', kind: 'activity' },
    ]);
  });

  it('email rules: Followed, Edit/new activity and New (created or moved into the category)', () => {
    const rules = [rule('a', { followed: true }), rule('b', { activity: true }), rule('c', { new: true })];
    const act = planNotifications(
      { type: 'activity', actorId: null, ownerId: null },
      { followerIds: ['a'], rules, canSee: all },
    );
    expect(act.email).toEqual([
      { userId: 'a', kind: 'followed' },
      { userId: 'b', kind: 'activity' },
    ]);
    for (const type of ['created', 'moved'] as const)
      expect(
        planNotifications({ type, actorId: null, ownerId: null }, { followerIds: [], rules, canSee: all }).email,
      ).toEqual([{ userId: 'c', kind: 'new' }]);
  });

  it('nobody is told about a ticket in a category they cannot see', () => {
    const p = planNotifications(
      { type: 'created', actorId: null, ownerId: 'x' },
      { followerIds: [], rules: [rule('y', { new: true })], canSee: (id) => id !== 'x' && id !== 'y' },
    );
    expect(p).toEqual({ inApp: [], email: [] });
  });

  it('SLA notices: a warning inside the warning window, and a breach once overdue', () => {
    const due = '2026-11-10T11:00:00.000Z';
    expect(slaNotice({ kind: 'response', status: 'counting', minutesLeft: 45, due }, 30)).toBeNull();
    expect(slaNotice({ kind: 'response', status: 'counting', minutesLeft: 30, due }, 30)).toEqual({
      kind: 'sla_warning',
      key: `response:${due}`,
    });
    expect(slaNotice({ kind: 'solution', status: 'breached', minutesLeft: -5, due }, 30)?.kind).toBe('sla_breached');
    expect(slaNotice({ kind: 'solution', status: 'paused', minutesLeft: 10, due }, 30)).toBeNull();
    expect(slaNotice({ kind: 'solution', status: 'met', minutesLeft: null, due }, 30)).toBeNull();
  });
});

describe('macros (spec 10)', () => {
  const form: MacroForm = {
    categoryId: 'support',
    userId: null,
    state: 'open',
    statusIds: ['s1'],
    priority: 'normal',
    reopenAt: null,
    followerIds: [],
    customFields: {},
  };
  const ctx = { userId: 'me-1', now: at(2026, 11, 6, 15), timeGroup: null };

  it('"Waiting +2 days, Back" sets the state and re-open time, then saves and goes back', () => {
    const r = runMacro(
      form,
      [
        { type: 'set_state', state: 'waiting' },
        { type: 'set_reopen', mode: 'relative', amount: 2, unit: 'days' },
        { type: 'back' },
      ],
      ctx,
    );
    expect(r.form.state).toBe('waiting');
    expect(r.form.reopenAt).toBe(at(2026, 11, 8, 15).toISOString());
    expect(r.steps).toEqual([{ type: 'back' }]);
  });

  it('Set user only replaces an existing owner when "replace" is ticked; @me is the current user', () => {
    expect(applyMacroAction(form, { type: 'set_user', userId: ME, replace: false }, ctx).userId).toBe('me-1');
    const owned = { ...form, userId: 'heather' };
    expect(applyMacroAction(owned, { type: 'set_user', userId: ME, replace: false }, ctx).userId).toBe('heather');
    expect(applyMacroAction(owned, { type: 'set_user', userId: 'ryan', replace: true }, ctx).userId).toBe('ryan');
  });

  it('statuses are added or replaced; followers are added once; custom fields are set', () => {
    expect(applyMacroAction(form, { type: 'set_status', statusIds: ['s2'], mode: 'add' }, ctx).statusIds).toEqual([
      's1',
      's2',
    ]);
    expect(applyMacroAction(form, { type: 'set_status', statusIds: ['s2'], mode: 'replace' }, ctx).statusIds).toEqual([
      's2',
    ]);
    const f = applyMacroAction(
      applyMacroAction(form, { type: 'add_follower', userId: ME }, ctx),
      { type: 'add_follower', userId: ME },
      ctx,
    );
    expect(f.followerIds).toEqual(['me-1']);
    expect(
      applyMacroAction(form, { type: 'set_custom_field', fieldId: 'f', value: 'quotation' }, ctx).customFields,
    ).toEqual({ f: 'quotation' });
  });

  it('re-open in working days skips weekends and bank holidays', () => {
    // Friday 15:00 + 1 working day = Monday 15:00; with Monday a holiday, Tuesday.
    expect(addWorkingDays(at(2026, 11, 6, 15), 1, null)).toEqual(at(2026, 11, 9, 15));
    const tg: TimeGroup = {
      timezone: 'Europe/London',
      week: [
        [{ start: '09:00', end: '17:00' }],
        [{ start: '09:00', end: '17:00' }],
        [{ start: '09:00', end: '17:00' }],
        [{ start: '09:00', end: '17:00' }],
        [{ start: '09:00', end: '17:00' }],
        [],
        [],
      ],
      exceptions: [{ date: '2026-11-09', intervals: [] }],
    };
    expect(addWorkingDays(at(2026, 11, 6, 15), 1, tg)).toEqual(at(2026, 11, 10, 15));
    expect(
      applyMacroAction(form, { type: 'set_reopen', mode: 'relative', amount: 3, unit: 'working_days' }, ctx).reopenAt,
    ).toBe(at(2026, 11, 11, 15).toISOString());
  });

  it('Open URL fills ticket fields, URL-encoded', () => {
    expect(
      renderMacroUrl('https://crm.example.com/?ticket={id}&contact={contact.name}', {
        id: 12,
        'contact.name': 'Dana & Co',
      }),
    ).toBe('https://crm.example.com/?ticket=12&contact=Dana%20%26%20Co');
  });

  it('macros are validated: a title, at least one action, Back/Delete last, http(s) URLs', () => {
    expect(validateMacro({ title: 'ok', actions: [{ type: 'save' }] })).toEqual([]);
    expect(validateMacro({ title: '', actions: [] })).toHaveLength(2);
    expect(validateMacro({ title: 'x', actions: [{ type: 'back' }, { type: 'save' }] })[0]).toMatch(/last/);
    expect(validateMacro({ title: 'x', actions: [{ type: 'open_url', url: 'javascript:alert(1)' }] })[0]).toMatch(
      /http/,
    );
    expect(validateMacro({ title: 'x', actions: [{ type: 'set_status', statusIds: [], mode: 'add' }] })[0]).toMatch(
      /status/,
    );
  });
});
