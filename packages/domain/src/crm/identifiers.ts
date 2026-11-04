import { getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/** Default region for numbers written without an international prefix (spec 12.3). */
export const DEFAULT_PHONE_REGION: CountryCode = 'GB';

export type NormaliseResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * A practical address check: no spaces or list separators (a pasted "a@b.com," is rejected),
 * and a domain made of DNS labels ending in a real-looking top-level domain.
 */
const EMAIL_RE = /^[^\s@,;<>()[\]\\"]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;

/** When an email is saved, the system lower-cases and trims it (spec 12.3). */
export function normaliseEmailAddress(raw: string): NormaliseResult {
  const value = raw.trim().toLowerCase();
  if (!value) return { ok: false, error: 'Email is empty.' };
  if (value.length > 320 || !EMAIL_RE.test(value))
    return { ok: false, error: `"${raw.trim()}" is not a valid email address.` };
  return { ok: true, value };
}

/** When a phone number is saved, the system stores it in E.164, assuming GB if no country code (spec 12.3). */
export function normalisePhone(raw: string, region: CountryCode = DEFAULT_PHONE_REGION): NormaliseResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'Phone number is empty.' };
  // Accept the common "00" international prefix as "+".
  const prepared = trimmed.startsWith('00') ? `+${trimmed.slice(2)}` : trimmed;
  const parsed = parsePhoneNumberFromString(prepared, region);
  if (!parsed || !parsed.isValid()) return { ok: false, error: `"${trimmed}" is not a valid phone number.` };
  return { ok: true, value: parsed.number };
}

export interface IdentifierErrors {
  emails: { index: number; error: string }[];
  phones: { index: number; error: string }[];
}

/**
 * Normalises a contact's email addresses and phone numbers, dropping duplicates that
 * become equal after normalisation and keeping the first-seen order.
 */
export function normaliseContactIdentifiers(input: {
  emails?: readonly string[];
  phones?: readonly string[];
}): { ok: true; emails: string[]; phones: string[] } | { ok: false; errors: IdentifierErrors } {
  const errors: IdentifierErrors = { emails: [], phones: [] };
  const emails: string[] = [];
  const phones: string[] = [];
  (input.emails ?? []).forEach((raw, index) => {
    const r = normaliseEmailAddress(raw);
    if (!r.ok) errors.emails.push({ index, error: r.error });
    else if (!emails.includes(r.value)) emails.push(r.value);
  });
  (input.phones ?? []).forEach((raw, index) => {
    const r = normalisePhone(raw);
    if (!r.ok) errors.phones.push({ index, error: r.error });
    else if (!phones.includes(r.value)) phones.push(r.value);
  });
  if (errors.emails.length || errors.phones.length) return { ok: false, errors };
  return { ok: true, emails, phones };
}

/** A contact can be matched only if it has at least one email or phone (spec 12.3). */
export function isMatchable(contact: { emails: readonly string[]; phones: readonly string[] }): boolean {
  return contact.emails.length > 0 || contact.phones.length > 0;
}

/**
 * Display format for a stored E.164 number (docs/open-questions.md, Q-P1-8): numbers in
 * the default region use national format (07911 123456); others use international
 * format (+33 1 42 68 53 00). Unparseable values are shown as stored.
 */
export function formatPhoneForDisplay(e164: string, region: CountryCode = DEFAULT_PHONE_REGION): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  // Compare calling codes: +44 is shared by GB, Jersey, Guernsey and the Isle of Man.
  return parsed.countryCallingCode === getCountryCallingCode(region)
    ? parsed.formatNational()
    : parsed.formatInternational();
}
