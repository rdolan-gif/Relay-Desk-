/** Dates in DD/MM/YYYY and 24-hour time by default, in the user's timezone (spec 18). */
export function formatDateTime(value: string | Date | null | undefined, timeZone = 'Europe/London'): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  })
    .format(d)
    .replace(',', '');
}
