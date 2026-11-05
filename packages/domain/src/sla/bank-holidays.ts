import type { TimeException } from './working-time.js';

/**
 * England and Wales bank holidays (GOV.UK), used when the live list at
 * https://www.gov.uk/bank-holidays.json cannot be fetched.
 */
export const ENGLAND_AND_WALES_BANK_HOLIDAYS: TimeException[] = [
  { date: '2026-01-01', title: "New Year's Day" },
  { date: '2026-04-03', title: 'Good Friday' },
  { date: '2026-04-06', title: 'Easter Monday' },
  { date: '2026-05-04', title: 'Early May bank holiday' },
  { date: '2026-05-25', title: 'Spring bank holiday' },
  { date: '2026-08-31', title: 'Summer bank holiday' },
  { date: '2026-12-25', title: 'Christmas Day' },
  { date: '2026-12-28', title: 'Boxing Day (substitute day)' },
  { date: '2027-01-01', title: "New Year's Day" },
  { date: '2027-03-26', title: 'Good Friday' },
  { date: '2027-03-29', title: 'Easter Monday' },
  { date: '2027-05-03', title: 'Early May bank holiday' },
  { date: '2027-05-31', title: 'Spring bank holiday' },
  { date: '2027-08-30', title: 'Summer bank holiday' },
  { date: '2027-12-27', title: 'Christmas Day (substitute day)' },
  { date: '2027-12-28', title: 'Boxing Day (substitute day)' },
];

/** Reads the GOV.UK JSON shape `{ "england-and-wales": { events: [{ title, date }] } }`. */
export function parseGovUkBankHolidays(json: unknown, division = 'england-and-wales'): TimeException[] {
  const events = (json as Record<string, { events?: { title?: unknown; date?: unknown }[] }>)?.[division]?.events;
  if (!Array.isArray(events)) throw new Error('Unexpected bank holiday data.');
  return events
    .filter((e) => typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
    .map((e) => ({ date: e.date as string, title: typeof e.title === 'string' ? e.title : 'Bank holiday' }));
}

/** Adds holidays (closed all day) that are not already listed; existing entries win. */
export function mergeExceptions(existing: TimeException[], add: TimeException[], from?: string): TimeException[] {
  const dates = new Set(existing.map((e) => e.date));
  const extra = add
    .filter((e) => !dates.has(e.date) && (!from || e.date >= from))
    .map((e) => ({ date: e.date, title: e.title, intervals: [] }));
  return [...existing, ...extra].sort((a, b) => a.date.localeCompare(b.date));
}
