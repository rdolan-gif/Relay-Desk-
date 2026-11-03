import { Secret, TOTP } from 'otpauth';

const ISSUER = 'Relay Desk';

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function totp(secret: string, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
}

export function totpUri(secret: string, label: string): string {
  return totp(secret, label).toString();
}

/** Accepts the current code and one step either side for clock drift. */
export function verifyTotp(secret: string, code: string, timestamp = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return totp(secret, 'x').validate({ token: code, timestamp, window: 1 }) !== null;
}

export function generateTotp(secret: string, timestamp = Date.now()): string {
  return totp(secret, 'x').generate({ timestamp });
}
