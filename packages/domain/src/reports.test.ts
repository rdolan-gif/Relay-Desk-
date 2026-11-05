import { describe, expect, it } from 'vitest';
import {
  backlogByDay,
  canKb,
  countByDay,
  dayKeys,
  firstResolvedAt,
  heatmap,
  isCycle,
  kbFolderRights,
  median,
  normaliseTags,
  percentMet,
  wasReopened,
  zonedTime,
} from './index.js';

const TZ = 'Europe/London';
const at = (d: number, h: number, mi = 0) => new Date(zonedTime(2026, 11, d, h * 60 + mi, TZ));

describe('reporting metrics (spec 17)', () => {
  it('median of an odd and even list, ignoring missing values', () => {
    expect(median([30, 10, 20])).toBe(20);
    expect(median([10, 40, 20, 30])).toBe(25);
    expect(median([])).toBeNull();
    expect(median([Number.NaN, 5])).toBe(5);
  });

  it('met % = met ÷ decided; undecided tickets are left out', () => {
    expect(percentMet([true, true, false, null])).toEqual({ met: 2, decided: 3, percent: 66.7 });
    expect(percentMet([null])).toEqual({ met: 0, decided: 0, percent: null });
  });

  it('a ticket counts as reopened when it goes from Closed or Archived back to Open or Waiting', () => {
    expect(
      wasReopened([
        { at: at(2, 9), state: 'closed' },
        { at: at(3, 9), state: 'open' },
      ]),
    ).toBe(true);
    expect(
      wasReopened([
        { at: at(2, 9), state: 'waiting' },
        { at: at(3, 9), state: 'open' },
        { at: at(4, 9), state: 'closed' },
      ]),
    ).toBe(false);
    expect(wasReopened([{ at: at(3, 9), state: 'waiting' }], 'closed')).toBe(true);
  });

  it('first close comes from the state history', () => {
    const ev = [
      { at: at(4, 9), state: 'closed' as const },
      { at: at(2, 9), state: 'waiting' as const },
      { at: at(3, 9), state: 'closed' as const },
    ];
    expect(firstResolvedAt(ev)).toEqual(at(3, 9));
    expect(firstResolvedAt([])).toBeNull();
  });

  it('backlog = tickets Open or Waiting at the end of each day', () => {
    const days = dayKeys(at(2, 12), at(4, 12), TZ);
    expect(days).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    const tickets = [
      { createdAt: at(2, 9), events: [{ at: at(3, 10), state: 'closed' as const }] },
      { createdAt: at(2, 10), events: [{ at: at(3, 10), state: 'waiting' as const }] },
      { createdAt: at(3, 23, 30), events: [] },
      { createdAt: at(2, 11), deletedAt: at(4, 8), events: [] },
    ];
    expect(backlogByDay(tickets, days, TZ)).toEqual([
      { day: '2026-11-02', count: 3 },
      { day: '2026-11-03', count: 3 },
      { day: '2026-11-04', count: 2 },
    ]);
  });

  it('counts per day and the inbound heatmap use local time', () => {
    const days = dayKeys(at(2, 0), at(3, 0), TZ);
    expect(countByDay([at(2, 23, 59), at(3, 0, 1), at(9, 1)], days, TZ)).toEqual([
      { day: '2026-11-02', count: 1 },
      { day: '2026-11-03', count: 1 },
    ]);
    const grid = heatmap([at(2, 9), at(2, 9, 30), at(8, 23)], TZ);
    expect(grid[0]![9]).toBe(2); // Monday 09:00
    expect(grid[6]![23]).toBe(1); // Sunday 23:00
  });
});

describe('knowledge base rights (spec 15)', () => {
  const parents = new Map<string, string | null>([
    ['root', null],
    ['products', 'root'],
    ['lighting', 'products'],
    ['hr', null],
  ]);
  const grants = [
    { folderId: 'root', view: true, create: true, update: true, delete: false },
    { folderId: 'lighting', view: true, create: false, update: false, delete: false },
  ];

  it('a grant applies to subfolders; the nearest grant wins; no grant means no access', () => {
    expect(kbFolderRights('products', parents, grants)).toEqual({
      view: true,
      create: true,
      update: true,
      delete: false,
    });
    expect(canKb('create', 'lighting', parents, grants)).toBe(false);
    expect(canKb('view', 'hr', parents, grants)).toBe(false);
    expect(canKb('delete', 'hr', parents, 'all')).toBe(true);
  });

  it('a folder cannot move into its own subfolder; tags are tidied', () => {
    expect(isCycle('products', 'lighting', parents)).toBe(true);
    expect(isCycle('lighting', 'hr', parents)).toBe(false);
    expect(normaliseTags([' LED ', 'led', 'Panels', ''])).toEqual(['led', 'panels']);
  });
});
