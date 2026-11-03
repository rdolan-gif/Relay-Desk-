/**
 * Login rate limiting (spec 18, "rate-limited login"). Pure policy: given recent
 * failed attempts, decide whether another attempt is allowed now.
 */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export function isLoginLocked(
  failureTimestamps: readonly number[],
  now: number,
  maxFailures = LOGIN_MAX_FAILURES,
  windowMs = LOGIN_WINDOW_MS,
): boolean {
  const recent = failureTimestamps.filter((t) => now - t < windowMs);
  return recent.length >= maxFailures;
}
