import { describe, expect, it } from 'vitest';
import { checkPasswordStrength } from './password-policy.js';
import { isLoginLocked } from './login-throttle.js';

describe('password strength (spec 4)', () => {
  it('when a password is shorter than 12 characters, the system rejects it', () => {
    expect(checkPasswordStrength('Sh0rt!pass')).toMatchObject({ ok: false });
  });
  it('when a password is long but guessable, the system rejects it', () => {
    expect(checkPasswordStrength('password1234')).toMatchObject({ ok: false });
  });
  it("when a password is mostly the user's own email, the system rejects it", () => {
    expect(checkPasswordStrength('janedoeexample', ['janedoe@example.com', 'Jane Doe'])).toMatchObject({ ok: false });
  });
  it('when a password is strong, the system accepts it', () => {
    expect(checkPasswordStrength('violet-harbour-tuesday-71')).toEqual({ ok: true });
  });
  it('when a password exceeds 128 characters, the system rejects it', () => {
    expect(checkPasswordStrength('x'.repeat(129))).toMatchObject({ ok: false });
  });
});

describe('login rate limit (spec 18)', () => {
  const now = 1_000_000_000;
  it('when there are fewer than 5 recent failures, login is allowed', () => {
    expect(isLoginLocked([now - 1, now - 2, now - 3, now - 4], now)).toBe(false);
  });
  it('when there are 5 failures in 15 minutes, login is locked', () => {
    expect(
      isLoginLocked(
        [1, 2, 3, 4, 5].map((n) => now - n * 1000),
        now,
      ),
    ).toBe(true);
  });
  it('failures older than the window do not count', () => {
    const old = now - 16 * 60 * 1000;
    expect(isLoginLocked([old, old, old, old, old], now)).toBe(false);
  });
});
