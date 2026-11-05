/**
 * Working-time arithmetic for SLA deadlines (spec 8). Pure: timezone conversion uses the
 * platform's Intl data, so a DST change never shifts local working hours.
 */

/** "HH:MM" local times; end is exclusive. "24:00" is allowed as an end. */
export interface Interval {
  start: string;
  end: string;
}

/** A dated exception: closed all day (no intervals) or special hours. Date is local "YYYY-MM-DD". */
export interface TimeException {
  date: string;
  title?: string;
  intervals?: Interval[];
}

export interface TimeGroup {
  timezone: string;
  /** Index 0 = Monday … 6 = Sunday. */
  week: Interval[][];
  exceptions: TimeException[];
}

const MINUTE = 60_000;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Local calendar parts of an instant in a timezone. */
export function localParts(at: Date, tz: string) {
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(at)) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return { year: p.year!, month: p.month!, day: p.day!, hour: p.hour!, minute: p.minute!, second: p.second! };
}

/** Offset (ms) of the timezone from UTC at an instant. */
function offsetAt(at: number, tz: string) {
  const p = localParts(new Date(at), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** The instant of a local wall-clock time. Gaps (spring forward) resolve to the later offset. */
export function zonedTime(year: number, month: number, day: number, minutes: number, tz: string): number {
  const guess = Date.UTC(year, month - 1, day) + minutes * MINUTE;
  let t = guess - offsetAt(guess, tz);
  t = guess - offsetAt(t, tz);
  return t;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Monday-based weekday of a calendar date. */
const weekday = (y: number, m: number, d: number) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;

function nextDay(y: number, m: number, d: number): [number, number, number] {
  const n = new Date(Date.UTC(y, m - 1, d + 1));
  return [n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate()];
}

/** Working intervals of one local day as UTC instants, sorted. */
function dayIntervals(tg: TimeGroup, y: number, m: number, d: number): [number, number][] {
  const date = isoDate(y, m, d);
  const exception = tg.exceptions.find((e) => e.date === date);
  const intervals = exception ? (exception.intervals ?? []) : (tg.week[weekday(y, m, d)] ?? []);
  return intervals
    .map(
      (i) =>
        [zonedTime(y, m, d, toMinutes(i.start), tg.timezone), zonedTime(y, m, d, toMinutes(i.end), tg.timezone)] as [
          number,
          number,
        ],
    )
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
}

const MAX_DAYS = 3660;

function hasAnyHours(tg: TimeGroup) {
  return tg.week.some((d) => d.some((i) => toMinutes(i.end) > toMinutes(i.start)));
}

/**
 * Adds working minutes to an instant. `null` time group = the clock runs 24/7 (spec 7.1).
 * Starting outside working hours, the count begins at the next working interval.
 */
export function addWorkingMinutes(start: Date, minutes: number, tg: TimeGroup | null): Date {
  if (!tg) return new Date(start.getTime() + minutes * MINUTE);
  if (!hasAnyHours(tg)) throw new Error('The working hours have no open time.');
  let remaining = minutes * MINUTE;
  const startMs = start.getTime();
  let { year: y, month: m, day: d } = localParts(start, tg.timezone);
  // The local day before can hold intervals that end after `start` only if they cross midnight; they don't.
  for (let i = 0; i < MAX_DAYS; i++) {
    for (const [a, b] of dayIntervals(tg, y, m, d)) {
      const from = Math.max(a, startMs);
      if (from >= b) continue;
      if (remaining <= 0) return new Date(from);
      const available = b - from;
      if (available >= remaining) return new Date(from + remaining);
      remaining -= available;
    }
    [y, m, d] = nextDay(y, m, d);
  }
  throw new Error('No working time found within ten years.');
}

/** Working minutes between two instants (0 if `to` is not after `from`). */
export function workingMinutesBetween(from: Date, to: Date, tg: TimeGroup | null): number {
  const a0 = from.getTime();
  const b0 = to.getTime();
  if (b0 <= a0) return 0;
  if (!tg) return (b0 - a0) / MINUTE;
  let total = 0;
  let { year: y, month: m, day: d } = localParts(from, tg.timezone);
  for (let i = 0; i < MAX_DAYS; i++) {
    const dayStart = zonedTime(y, m, d, 0, tg.timezone);
    if (dayStart >= b0) break;
    for (const [a, b] of dayIntervals(tg, y, m, d)) {
      const s = Math.max(a, a0);
      const e = Math.min(b, b0);
      if (e > s) total += e - s;
    }
    [y, m, d] = nextDay(y, m, d);
  }
  return total / MINUTE;
}

/** Problems with a time group, for the settings form. */
export function validateTimeGroup(tg: TimeGroup): string[] {
  const errors: string[] = [];
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tg.timezone });
  } catch {
    errors.push(`Unknown timezone "${tg.timezone}".`);
  }
  if (tg.week.length !== 7) errors.push('Give hours for all seven weekdays.');
  const checkIntervals = (list: Interval[], where: string) => {
    const sorted = [...list].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    sorted.forEach((i, n) => {
      if (!TIME_RE.test(i.start) || !TIME_RE.test(i.end) || i.start === '24:00')
        errors.push(`${where}: times must be HH:MM.`);
      else if (toMinutes(i.end) <= toMinutes(i.start))
        errors.push(`${where}: ${i.start}–${i.end} ends before it starts.`);
      else if (n > 0 && toMinutes(i.start) < toMinutes(sorted[n - 1]!.end)) errors.push(`${where}: intervals overlap.`);
    });
  };
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  tg.week.forEach((list, i) => checkIntervals(list, DAYS[i] ?? `Day ${i + 1}`));
  if (!errors.length && !hasAnyHours(tg)) errors.push('Add at least one working interval.');
  const seen = new Set<string>();
  for (const e of tg.exceptions) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || Number.isNaN(Date.parse(e.date)))
      errors.push(`"${e.date}" is not a date.`);
    else if (seen.has(e.date)) errors.push(`${e.date} is listed twice.`);
    seen.add(e.date);
    checkIntervals(e.intervals ?? [], e.date);
  }
  return [...new Set(errors)];
}
