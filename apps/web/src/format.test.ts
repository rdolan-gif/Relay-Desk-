import { describe, expect, it } from 'vitest';
import { formatDateTime } from './format';

describe('date formatting (spec 18)', () => {
  it('formats dates as DD/MM/YYYY with 24-hour time in the user timezone', () => {
    expect(formatDateTime('2026-07-01T13:05:00Z', 'Europe/London')).toBe('01/07/2026 14:05');
    expect(formatDateTime('2026-12-01T13:05:00Z', 'Europe/London')).toBe('01/12/2026 13:05');
  });
});
