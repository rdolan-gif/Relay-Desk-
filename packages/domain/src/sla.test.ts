import { describe, expect, it } from 'vitest';
import {
  addWorkingMinutes,
  chooseSla,
  computeSla,
  ENGLAND_AND_WALES_BANK_HOLIDAYS,
  isEligible,
  mergeExceptions,
  parseGovUkBankHolidays,
  pickAgent,
  planDistribution,
  slaIndicator,
  slaTargets,
  validateSla,
  validateTimeGroup,
  workingMinutesBetween,
  zonedTime,
  type DistributionCandidate,
  type SlaDefinition,
  type SlaTicket,
  type TimeGroup,
} from './index.js';

const TZ = 'Europe/London';
/** A local London wall-clock time. */
const at = (y: number, m: number, d: number, h: number, mi = 0) => new Date(zonedTime(y, m, d, h * 60 + mi, TZ));
const nineToFive = [{ start: '09:00', end: '17:00' }];
const MON_FRI: TimeGroup = {
  timezone: TZ,
  week: [nineToFive, nineToFive, nineToFive, nineToFive, nineToFive, [], []],
  exceptions: [],
};
const DAILY: TimeGroup = { ...MON_FRI, week: Array.from({ length: 7 }, () => nineToFive) };
/** Ricoman's office hours (owner O-8): Mon–Thu 08:30–17:00, Fri 08:30–16:00. */
const RICOMAN: TimeGroup = {
  timezone: TZ,
  week: [
    ...Array.from({ length: 4 }, () => [{ start: '08:30', end: '17:00' }]),
    [{ start: '08:30', end: '16:00' }],
    [],
    [],
  ],
  exceptions: [],
};
const hours = (n: number) => n * 60;

const ticket = (over: Partial<SlaTicket> = {}): SlaTicket => ({
  createdAt: at(2026, 11, 10, 10),
  state: 'open',
  firstAnswerAt: null,
  closedAt: null,
  waitingSince: null,
  pausedSeconds: 0,
  deadlineManual: false,
  deadline: null,
  noReplyNeeded: false,
  firstAnswerMet: null,
  solutionMet: null,
  ...over,
});

describe('SLA acceptance tests (spec 8)', () => {
  it('when a ticket arrives at 16:00 with 4 h to solve and 09:00–17:00 every day, the deadline is 12:00 the next day', () => {
    expect(addWorkingMinutes(at(2026, 11, 10, 16), hours(4), DAILY)).toEqual(at(2026, 11, 11, 12));
  });

  it('when a ticket arrives at 16:00 Friday with 4 h to solve and Mon–Fri 09–17, the deadline is Monday 12:00', () => {
    expect(addWorkingMinutes(at(2026, 11, 6, 16), hours(4), MON_FRI)).toEqual(at(2026, 11, 9, 12));
  });

  it('when that Monday is a bank holiday in the time group, the deadline is Tuesday 12:00', () => {
    const tg = { ...MON_FRI, exceptions: [{ date: '2026-11-09', title: 'Bank holiday', intervals: [] }] };
    expect(addWorkingMinutes(at(2026, 11, 6, 16), hours(4), tg)).toEqual(at(2026, 11, 10, 12));
  });

  it('with Response 1 h and Solution 8 h, a ticket created 10:00 Tuesday has its first answer due 11:00 Tuesday and its deadline 11:00 Wednesday', () => {
    const r = computeSla(ticket(), { response: hours(1), solution: hours(8) }, MON_FRI, at(2026, 11, 10, 10));
    expect(r.firstAnswerDeadline).toEqual(at(2026, 11, 10, 11));
    expect(r.deadline).toEqual(at(2026, 11, 11, 11));
  });

  it('when a ticket is Waiting from 12:00 to 15:00 the same working day, the deadline moves 3 working hours later', () => {
    const targets = { response: null, solution: hours(8) };
    const created = computeSla(ticket(), targets, MON_FRI, at(2026, 11, 10, 10));
    expect(created.deadline).toEqual(at(2026, 11, 11, 10));
    const waiting = computeSla(ticket({ ...created, state: 'waiting' }), targets, MON_FRI, at(2026, 11, 10, 12));
    expect(waiting.waitingSince).toEqual(at(2026, 11, 10, 12));
    const reopened = computeSla(ticket({ ...waiting, state: 'open' }), targets, MON_FRI, at(2026, 11, 10, 15));
    expect(reopened.pausedSeconds).toBe(3 * 3600);
    expect(reopened.waitingSince).toBeNull();
    expect(reopened.deadline).toEqual(at(2026, 11, 11, 13));
  });

  it("when the contact's account has its own SLA, the account's times are used with the category's working hours", () => {
    const category: SlaDefinition = {
      unit: 'hours',
      basisFieldId: null,
      targets: {
        low: { response: null, solution: 40 },
        normal: { response: null, solution: 16 },
        high: { response: null, solution: 8 },
      },
    };
    const account: SlaDefinition = {
      ...category,
      targets: { ...category.targets, normal: { response: null, solution: 4 } },
    };
    const sla = chooseSla(account, category)!;
    const targets = slaTargets(sla, { priority: 'normal', customFields: {} });
    expect(targets).toEqual({ response: null, solution: 240 });
    // Working hours still come from the category's time group.
    expect(
      computeSla(ticket({ createdAt: at(2026, 11, 6, 16) }), targets, MON_FRI, at(2026, 11, 6, 16)).deadline,
    ).toEqual(at(2026, 11, 9, 12));
    expect(chooseSla(null, category)).toBe(category);
    expect(chooseSla(null, null)).toBeNull();
  });

  it('a DST change weekend in Europe/London does not shift working hours', () => {
    // Clocks go back on Sunday 25/10/2026 and forward on Sunday 29/03/2026.
    expect(addWorkingMinutes(at(2026, 10, 23, 16), hours(4), MON_FRI)).toEqual(at(2026, 10, 26, 12));
    expect(at(2026, 10, 26, 12).toISOString()).toBe('2026-10-26T12:00:00.000Z');
    expect(addWorkingMinutes(at(2026, 3, 27, 16), hours(4), MON_FRI)).toEqual(at(2026, 3, 30, 12));
    expect(at(2026, 3, 30, 12).toISOString()).toBe('2026-03-30T11:00:00.000Z');
    expect(workingMinutesBetween(at(2026, 10, 23, 9), at(2026, 10, 26, 17), MON_FRI)).toBe(hours(16));
  });
});

describe('working time', () => {
  it('a ticket created outside working hours starts counting when work starts', () => {
    expect(addWorkingMinutes(at(2026, 11, 7, 11), 30, MON_FRI)).toEqual(at(2026, 11, 9, 9, 30));
    expect(addWorkingMinutes(at(2026, 11, 10, 7), 0, MON_FRI)).toEqual(at(2026, 11, 10, 9));
  });

  it('with no working hours the clock runs 24/7', () => {
    expect(addWorkingMinutes(at(2026, 11, 6, 16), hours(4), null)).toEqual(at(2026, 11, 6, 20));
    expect(workingMinutesBetween(at(2026, 11, 6, 16), at(2026, 11, 7, 16), null)).toBe(hours(24));
  });

  it("Ricoman's hours: a purchase order at 15:00 Friday (2 h) is due 09:30 Monday", () => {
    expect(addWorkingMinutes(at(2026, 11, 6, 15), hours(2), RICOMAN)).toEqual(at(2026, 11, 9, 9, 30));
    expect(addWorkingMinutes(at(2026, 11, 5, 16), hours(8), RICOMAN)).toEqual(at(2026, 11, 6, 15, 30));
  });

  it('several intervals a day, and special hours on an exception date', () => {
    const split: TimeGroup = {
      ...MON_FRI,
      week: MON_FRI.week.map((d) =>
        d.length
          ? [
              { start: '09:00', end: '12:00' },
              { start: '13:00', end: '17:00' },
            ]
          : [],
      ),
    };
    expect(addWorkingMinutes(at(2026, 11, 10, 11), hours(2), split)).toEqual(at(2026, 11, 10, 14));
    const halfDay = { ...MON_FRI, exceptions: [{ date: '2026-12-24', intervals: [{ start: '09:00', end: '12:00' }] }] };
    expect(addWorkingMinutes(at(2026, 12, 24, 11), hours(2), halfDay)).toEqual(at(2026, 12, 25, 10));
  });

  it('time groups are validated', () => {
    expect(validateTimeGroup(MON_FRI)).toEqual([]);
    expect(validateTimeGroup({ ...MON_FRI, timezone: 'Mars/Olympus' })[0]).toMatch(/timezone/);
    expect(
      validateTimeGroup({ ...MON_FRI, week: [[{ start: '17:00', end: '09:00' }], [], [], [], [], [], []] })[0],
    ).toMatch(/ends before/);
    expect(
      validateTimeGroup({
        ...MON_FRI,
        week: [
          [
            { start: '09:00', end: '12:00' },
            { start: '11:00', end: '13:00' },
          ],
          [],
          [],
          [],
          [],
          [],
          [],
        ],
      })[0],
    ).toMatch(/overlap/);
    expect(validateTimeGroup({ ...MON_FRI, week: [[], [], [], [], [], [], []] })[0]).toMatch(/at least one/);
    expect(validateTimeGroup({ ...MON_FRI, exceptions: [{ date: '2026-12-25' }, { date: '2026-12-25' }] })[0]).toMatch(
      /twice/,
    );
  });
});

describe('UK bank holidays', () => {
  it('the GOV.UK list is read and merged without overwriting existing dates', () => {
    const parsed = parseGovUkBankHolidays({
      'england-and-wales': {
        events: [
          { title: 'Christmas Day', date: '2026-12-25' },
          { title: 'Bad', date: 'x' },
        ],
      },
    });
    expect(parsed).toEqual([{ date: '2026-12-25', title: 'Christmas Day' }]);
    const merged = mergeExceptions(
      [{ date: '2026-12-25', title: 'Office party', intervals: [{ start: '09:00', end: '12:00' }] }],
      ENGLAND_AND_WALES_BANK_HOLIDAYS,
      '2026-06-01',
    );
    expect(merged.find((e) => e.date === '2026-12-25')?.title).toBe('Office party');
    expect(merged.some((e) => e.date === '2026-05-25')).toBe(false);
    expect(merged.find((e) => e.date === '2026-12-28')).toMatchObject({ intervals: [] });
    expect(() => parseGovUkBankHolidays({})).toThrow();
  });
});

describe('which targets apply', () => {
  const byEnquiry: SlaDefinition = {
    unit: 'hours',
    basisFieldId: 'f-enquiry',
    targets: {
      purchase_order: { response: 2, solution: 40 },
      quotation: { response: 4, solution: 40 },
      _other: { response: 8, solution: 40 },
    },
  };

  it('an SLA based on the enquiry type uses 2 / 4 / 8 hours, and anything else for unknown values (owner O-11)', () => {
    const t = (v: unknown) => slaTargets(byEnquiry, { priority: 'high', customFields: { 'f-enquiry': v } })?.response;
    expect(t('purchase_order')).toBe(120);
    expect(t('quotation')).toBe(240);
    expect(t('general')).toBe(480);
    expect(t(undefined)).toBe(480);
  });

  it('a priority SLA in minutes uses the priority', () => {
    const sla: SlaDefinition = {
      unit: 'minutes',
      basisFieldId: null,
      targets: {
        low: { response: null, solution: 90 },
        normal: { response: 15, solution: 60 },
        high: { response: 5, solution: 30 },
      },
    };
    expect(slaTargets(sla, { priority: 'high', customFields: {} })).toEqual({ response: 5, solution: 30 });
  });

  it('SLA definitions are validated: Solution required and positive, Response optional', () => {
    expect(validateSla(byEnquiry, ['purchase_order', 'quotation', 'general'])).toEqual([
      'Set a Solution time for "general".',
    ]);
    expect(
      validateSla({
        unit: 'hours',
        basisFieldId: null,
        targets: {
          low: { response: null, solution: 1 },
          normal: { response: 0, solution: 1 },
          high: { response: null, solution: 0 },
        },
      }),
    ).toHaveLength(2);
    expect(
      validateSla({
        unit: 'hours',
        basisFieldId: null,
        targets: {
          low: { response: null, solution: 1 },
          normal: { response: null, solution: 1 },
          high: { response: null, solution: 1 },
          urgent: { response: null, solution: 1 },
        },
      })[0],
    ).toMatch(/not a priority/);
  });
});

describe('deadlines and outcome flags (spec 8)', () => {
  const targets = { response: hours(1), solution: hours(8) };

  it('a manual deadline is never recalculated; the first-answer deadline still follows the SLA', () => {
    const manual = at(2026, 12, 1, 9);
    const r = computeSla(ticket({ deadlineManual: true, deadline: manual }), targets, MON_FRI, at(2026, 11, 10, 10));
    expect(r.deadline).toEqual(manual);
    expect(r.firstAnswerDeadline).toEqual(at(2026, 11, 10, 11));
  });

  it('with no SLA and no manual deadline there are no deadlines', () => {
    const r = computeSla(ticket({ deadline: at(2026, 12, 1, 9) }), null, MON_FRI, at(2026, 11, 10, 10));
    expect(r).toMatchObject({ deadline: null, firstAnswerDeadline: null, firstAnswerMet: null, solutionMet: null });
  });

  it('first_answer_met is set when the reply goes out, and is false once the deadline passes without one', () => {
    expect(
      computeSla(ticket({ firstAnswerAt: at(2026, 11, 10, 10, 30) }), targets, MON_FRI, at(2026, 11, 10, 10, 30))
        .firstAnswerMet,
    ).toBe(true);
    expect(
      computeSla(ticket({ firstAnswerAt: at(2026, 11, 10, 11, 1) }), targets, MON_FRI, at(2026, 11, 10, 11, 1))
        .firstAnswerMet,
    ).toBe(false);
    expect(computeSla(ticket(), targets, MON_FRI, at(2026, 11, 10, 10, 59)).firstAnswerMet).toBeNull();
    expect(computeSla(ticket(), targets, MON_FRI, at(2026, 11, 10, 11, 1)).firstAnswerMet).toBe(false);
  });

  it('the first-answer clock is not paused by Waiting', () => {
    expect(
      computeSla(
        ticket({ state: 'waiting', waitingSince: at(2026, 11, 10, 10, 15) }),
        targets,
        MON_FRI,
        at(2026, 11, 10, 11, 5),
      ).firstAnswerMet,
    ).toBe(false);
  });

  it('outcomes are frozen once decided: a late reply does not turn a missed first answer into met', () => {
    const r = computeSla(
      ticket({ firstAnswerMet: false, firstAnswerAt: at(2026, 11, 10, 10, 30) }),
      targets,
      MON_FRI,
      at(2026, 11, 10, 12),
    );
    expect(r.firstAnswerMet).toBe(false);
    const closedLate = computeSla(ticket({ solutionMet: true, state: 'open' }), targets, MON_FRI, at(2026, 11, 20, 12));
    expect(closedLate.solutionMet).toBe(true);
  });

  it('solution_met is decided by closing (or archiving) in time, or false once an Open ticket passes its deadline', () => {
    expect(
      computeSla(ticket({ state: 'closed', closedAt: at(2026, 11, 11, 9) }), targets, MON_FRI, at(2026, 11, 11, 9))
        .solutionMet,
    ).toBe(true);
    expect(
      computeSla(ticket({ state: 'archived', closedAt: at(2026, 11, 11, 12) }), targets, MON_FRI, at(2026, 11, 11, 12))
        .solutionMet,
    ).toBe(false);
    expect(computeSla(ticket(), targets, MON_FRI, at(2026, 11, 11, 11, 1)).solutionMet).toBe(false);
    // A Waiting ticket is not breached while paused.
    expect(
      computeSla(
        ticket({ state: 'waiting', waitingSince: at(2026, 11, 10, 12) }),
        targets,
        MON_FRI,
        at(2026, 11, 12, 12),
      ).solutionMet,
    ).toBeNull();
  });

  it('closing straight from Waiting adds the paused time before judging the deadline', () => {
    const r = computeSla(
      ticket({ state: 'closed', waitingSince: at(2026, 11, 10, 12), closedAt: at(2026, 11, 11, 12) }),
      targets,
      MON_FRI,
      at(2026, 11, 11, 12),
    );
    expect(r.pausedSeconds).toBe(8 * 3600);
    expect(r.solutionMet).toBe(true);
  });

  it('"FYI – no reply needed" never counts as a missed first answer (owner O-12)', () => {
    expect(
      computeSla(
        ticket({ noReplyNeeded: true, state: 'closed', closedAt: at(2026, 11, 10, 10, 5) }),
        targets,
        MON_FRI,
        at(2026, 11, 12, 10),
      ).firstAnswerMet,
    ).toBeNull();
  });
});

describe('SLA icons (spec 6.2)', () => {
  const base = {
    state: 'open' as const,
    firstAnswerDeadline: at(2026, 11, 10, 11),
    deadline: at(2026, 11, 11, 11),
    firstAnswerAt: null,
    firstAnswerMet: null,
    solutionMet: null,
    noReplyNeeded: false,
    waitingSince: null,
  };

  it('a hand counts down to the first answer, then a stopwatch to the solution', () => {
    expect(slaIndicator(base, MON_FRI, at(2026, 11, 10, 10, 30))).toMatchObject({
      kind: 'response',
      status: 'counting',
      minutesLeft: 30,
    });
    expect(
      slaIndicator(
        { ...base, firstAnswerAt: at(2026, 11, 10, 10, 30), firstAnswerMet: true },
        MON_FRI,
        at(2026, 11, 10, 16),
      ),
    ).toMatchObject({ kind: 'solution', status: 'counting', minutesLeft: 180 });
  });

  it('paused while Waiting, breached with negative time, met green, missed red', () => {
    const answered = { ...base, firstAnswerMet: true };
    expect(
      slaIndicator({ ...answered, state: 'waiting', waitingSince: at(2026, 11, 10, 16) }, MON_FRI, at(2026, 11, 13, 9)),
    ).toMatchObject({ status: 'paused', minutesLeft: 180 });
    expect(slaIndicator({ ...answered, solutionMet: false }, MON_FRI, at(2026, 11, 11, 12))).toMatchObject({
      status: 'breached',
      minutesLeft: -60,
    });
    expect(
      slaIndicator({ ...answered, state: 'closed', solutionMet: true }, MON_FRI, at(2026, 11, 11, 12)),
    ).toMatchObject({ status: 'met', minutesLeft: null });
    expect(
      slaIndicator({ ...answered, state: 'closed', solutionMet: false }, MON_FRI, at(2026, 11, 11, 12)),
    ).toMatchObject({ status: 'missed' });
  });

  it('no icons when there is no SLA and no manual deadline', () => {
    expect(
      slaIndicator({ ...base, firstAnswerDeadline: null, deadline: null }, MON_FRI, at(2026, 11, 10, 10)),
    ).toBeNull();
  });
});

describe('distribution (spec 9)', () => {
  const agent = (userId: string, over: Partial<DistributionCandidate> = {}): DistributionCandidate => ({
    userId,
    active: true,
    categoryAccess: true,
    limit: 2,
    queueInRights: true,
    loggedIn: true,
    openCount: 0,
    lastAssignedAt: null,
    ...over,
  });

  it('an agent is eligible only with Access, a limit, the queue in their rights, logged in and below the limit', () => {
    expect(isEligible(agent('a'))).toBe(true);
    for (const over of [
      { active: false },
      { categoryAccess: false },
      { limit: null },
      { queueInRights: false },
      { loggedIn: false },
      { openCount: 2 },
    ])
      expect(isEligible(agent('a', over)), JSON.stringify(over)).toBe(false);
  });

  it('the agent with the fewest Open tickets wins; ties go to the longest since their last assignment', () => {
    expect(pickAgent([agent('a', { openCount: 1 }), agent('b', { openCount: 0 })])).toBe('b');
    expect(
      pickAgent([
        agent('a', { lastAssignedAt: at(2026, 11, 10, 10) }),
        agent('b', { lastAssignedAt: at(2026, 11, 10, 9) }),
      ]),
    ).toBe('b');
    expect(pickAgent([agent('a', { lastAssignedAt: at(2026, 11, 10, 10) }), agent('b')])).toBe('b');
    expect(pickAgent([agent('a', { loggedIn: false })])).toBeNull();
  });

  it('with limit 2 and three new tickets for one eligible agent, the third waits in the backlog', () => {
    const plan = planDistribution([1, 2, 3], [agent('a')], at(2026, 11, 10, 10));
    expect(plan).toEqual([
      { ticketId: 1, userId: 'a' },
      { ticketId: 2, userId: 'a' },
    ]);
    // One goes to Waiting: the Open count drops, and the backlog ticket is taken.
    expect(planDistribution([3], [agent('a', { openCount: 1 })], at(2026, 11, 10, 11))).toEqual([
      { ticketId: 3, userId: 'a' },
    ]);
  });

  it('backlog tickets spread across agents, oldest first', () => {
    expect(
      planDistribution(
        [1, 2, 3],
        [agent('a'), agent('b', { lastAssignedAt: at(2026, 11, 1, 9) })],
        at(2026, 11, 10, 10),
      ),
    ).toEqual([
      { ticketId: 1, userId: 'a' },
      { ticketId: 2, userId: 'b' },
      { ticketId: 3, userId: 'a' },
    ]);
  });
});
