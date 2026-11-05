import { normaliseEmailAddress, normalisePhone } from '../crm/identifiers.js';

/** Custom field types (spec 7.3). */
export const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'datetime',
  'select',
  'multiselect',
  'radio',
  'checkbox',
  'email',
  'phone',
  'url',
  'user',
  'contact',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const OPTION_FIELD_TYPES: readonly FieldType[] = ['select', 'multiselect', 'radio'];

export interface FieldOption {
  /** Stored value. Changing it orphans stored data, so the admin UI warns first. */
  value: string;
  label: string;
  sort: number;
}

export interface CustomFieldDef {
  id: string;
  /** Immutable internal key, used in templates and the API. */
  key: string;
  name: string;
  type: FieldType;
  options: FieldOption[];
  defaultValue: unknown;
}

export type FieldValue = string | number | boolean | string[] | null;
export type ValueResult = { ok: true; value: FieldValue } | { ok: false; error: string };

const KEY_RE = /^[a-z][a-z0-9_]{0,62}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_MAX = 10_000;

export function isFieldType(v: string): v is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(v);
}

export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Validates and normalises one value for a field. `null`/empty clears the field.
 * Emails are lower-cased and phones stored in E.164, like the contact's own fields.
 */
export function validateFieldValue(def: Pick<CustomFieldDef, 'type' | 'options' | 'name'>, raw: unknown): ValueResult {
  if (isEmptyValue(raw)) return { ok: true, value: def.type === 'multiselect' ? [] : null };
  const fail = (error: string): ValueResult => ({ ok: false, error: `${def.name}: ${error}` });
  const optionValues = def.options.map((o) => o.value);
  switch (def.type) {
    case 'text':
    case 'textarea':
      if (typeof raw !== 'string') return fail('must be text.');
      if (raw.length > TEXT_MAX) return fail(`must be at most ${TEXT_MAX} characters.`);
      return { ok: true, value: def.type === 'text' ? raw.trim() : raw };
    case 'number': {
      const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
      if (typeof n !== 'number' || !Number.isFinite(n)) return fail('must be a number.');
      return { ok: true, value: n };
    }
    case 'date':
      if (typeof raw !== 'string' || !isValidDate(raw)) return fail('must be a date (YYYY-MM-DD).');
      return { ok: true, value: raw };
    case 'datetime': {
      if (typeof raw !== 'string') return fail('must be a date and time.');
      const d = new Date(raw);
      if (Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(raw)) return fail('must be an ISO date and time.');
      return { ok: true, value: d.toISOString() };
    }
    case 'select':
    case 'radio':
      if (typeof raw !== 'string' || !optionValues.includes(raw)) return fail('is not one of the options.');
      return { ok: true, value: raw };
    case 'multiselect': {
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) return fail('must be a list of options.');
      const unique = [...new Set(raw as string[])];
      if (unique.some((v) => !optionValues.includes(v))) return fail('contains a value that is not an option.');
      return { ok: true, value: unique };
    }
    case 'checkbox':
      if (typeof raw !== 'boolean') return fail('must be true or false.');
      return { ok: true, value: raw };
    case 'email': {
      if (typeof raw !== 'string') return fail('must be an email address.');
      const r = normaliseEmailAddress(raw);
      return r.ok ? { ok: true, value: r.value } : fail(r.error);
    }
    case 'phone': {
      if (typeof raw !== 'string') return fail('must be a phone number.');
      const r = normalisePhone(raw);
      return r.ok ? { ok: true, value: r.value } : fail(r.error);
    }
    case 'url': {
      if (typeof raw !== 'string') return fail('must be a URL.');
      try {
        const u = new URL(raw.trim());
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return fail('must start with http:// or https://.');
        return { ok: true, value: u.toString() };
      } catch {
        return fail('must be a URL.');
      }
    }
    case 'user':
    case 'contact':
      if (typeof raw !== 'string' || !UUID_RE.test(raw)) return fail('must be an ID.');
      return { ok: true, value: raw.toLowerCase() };
  }
}

export type DefinitionCheck = { ok: true } | { ok: false; errors: string[] };

/** Checks a field definition before it is saved. `previous` is the stored version, if any. */
export function validateFieldDefinition(
  def: Omit<CustomFieldDef, 'id'>,
  previous?: Pick<CustomFieldDef, 'key' | 'type'>,
): DefinitionCheck {
  const errors: string[] = [];
  if (!KEY_RE.test(def.key)) errors.push('Key must start with a letter and use only a-z, 0-9 and _.');
  if (previous && previous.key !== def.key) errors.push('The internal key cannot be changed.');
  if (previous && previous.type !== def.type) errors.push('The field type cannot be changed.');
  if (!def.name.trim()) errors.push('Name is required.');
  const needsOptions = OPTION_FIELD_TYPES.includes(def.type);
  if (needsOptions && def.options.length === 0) errors.push('Add at least one option.');
  if (!needsOptions && def.options.length > 0) errors.push('Only select, multi-select and radio fields have options.');
  const values = def.options.map((o) => o.value);
  if (new Set(values).size !== values.length) errors.push('Option values must be unique.');
  if (def.options.some((o) => !o.value.trim() || !o.label.trim())) errors.push('Options need a value and a label.');
  if (!isEmptyValue(def.defaultValue)) {
    const r = validateFieldValue({ ...def, name: 'Default value' }, def.defaultValue);
    if (!r.ok) errors.push(r.error);
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * Option values present before but not after. Stored data using them becomes
 * unreadable in the UI, so the admin is warned with a usage count first (spec 7.3).
 */
export function removedOptionValues(before: readonly FieldOption[], after: readonly FieldOption[]): string[] {
  const kept = new Set(after.map((o) => o.value));
  return before.map((o) => o.value).filter((v) => !kept.has(v));
}

/** Options in display order. */
export function sortedOptions(options: readonly FieldOption[]): FieldOption[] {
  return [...options].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
}
