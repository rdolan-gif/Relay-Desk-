import type { FieldType } from '../custom-fields/fields.js';
import { normaliseEmailAddress, normalisePhone } from '../crm/identifiers.js';

/** How a field behaves in filters. */
export type FilterKind =
  | 'text'
  | 'email'
  | 'phone'
  | 'text_list'
  | 'email_list'
  | 'phone_list'
  | 'number'
  | 'date'
  | 'datetime'
  | 'option'
  | 'option_list'
  | 'boolean'
  | 'ref';

/** Operators (spec 6.1, "Filter"): is, is not, contains, empty, before/after, in last N days. */
export const FILTER_OPS = [
  'is',
  'is_not',
  'contains',
  'empty',
  'not_empty',
  'before',
  'after',
  'in_last_days',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

const TEXTUAL: FilterOp[] = ['is', 'is_not', 'contains', 'empty', 'not_empty'];
const DATED: FilterOp[] = ['is', 'before', 'after', 'in_last_days', 'empty', 'not_empty'];
const EQUALITY: FilterOp[] = ['is', 'is_not', 'empty', 'not_empty'];

export const OPS_BY_KIND: Record<FilterKind, readonly FilterOp[]> = {
  text: TEXTUAL,
  email: TEXTUAL,
  phone: TEXTUAL,
  text_list: TEXTUAL,
  email_list: TEXTUAL,
  phone_list: TEXTUAL,
  number: EQUALITY,
  date: DATED,
  datetime: DATED,
  option: EQUALITY,
  option_list: EQUALITY,
  boolean: ['is'],
  ref: EQUALITY,
};

export function filterKindForFieldType(type: FieldType): FilterKind {
  switch (type) {
    case 'text':
    case 'textarea':
    case 'url':
      return 'text';
    case 'email':
      return 'email';
    case 'phone':
      return 'phone';
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'select':
    case 'radio':
      return 'option';
    case 'multiselect':
      return 'option_list';
    case 'checkbox':
      return 'boolean';
    case 'user':
    case 'contact':
      return 'ref';
  }
}

export interface FilterFieldDef {
  /** System field key (e.g. "name") or "custom.<fieldId>". */
  key: string;
  label: string;
  kind: FilterKind;
}

export interface FilterCondition {
  field: string;
  op: FilterOp;
  value?: string | number | boolean;
}

export type ConditionsCheck = { ok: true; conditions: FilterCondition[] } | { ok: false; errors: string[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_VALUE: FilterOp[] = ['empty', 'not_empty'];
export const MAX_CONDITIONS = 20;

/**
 * Validates filter conditions against the list's fields and normalises their values
 * (emails lower-cased, phones in E.164 where complete, dates checked). All conditions
 * must match (AND).
 */
export function validateConditions(
  fields: readonly FilterFieldDef[],
  conditions: readonly FilterCondition[],
): ConditionsCheck {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const errors: string[] = [];
  const out: FilterCondition[] = [];
  if (conditions.length > MAX_CONDITIONS) errors.push(`At most ${MAX_CONDITIONS} conditions.`);
  for (const c of conditions) {
    const def = byKey.get(c.field);
    if (!def) {
      errors.push(`Unknown filter field ${c.field}.`);
      continue;
    }
    if (!OPS_BY_KIND[def.kind].includes(c.op)) {
      errors.push(`${def.label}: operator "${c.op}" is not available.`);
      continue;
    }
    if (NO_VALUE.includes(c.op)) {
      out.push({ field: c.field, op: c.op });
      continue;
    }
    const v = normaliseFilterValue(def.kind, c.op, c.value);
    if (v === undefined) {
      errors.push(`${def.label}: a valid value is required.`);
      continue;
    }
    out.push({ field: c.field, op: c.op, value: v });
  }
  return errors.length ? { ok: false, errors } : { ok: true, conditions: out };
}

function normaliseFilterValue(kind: FilterKind, op: FilterOp, value: unknown): string | number | boolean | undefined {
  if (op === 'in_last_days') {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 36_500 ? n : undefined;
  }
  switch (kind) {
    case 'boolean':
      return typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : undefined;
    case 'number': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
    }
    case 'date':
    case 'datetime':
      return typeof value === 'string' && DATE_RE.test(value) ? value : undefined;
    case 'ref':
      return typeof value === 'string' && UUID_RE.test(value) ? value.toLowerCase() : undefined;
    case 'email':
    case 'email_list': {
      if (typeof value !== 'string' || !value.trim()) return undefined;
      if (op === 'contains') return value.trim().toLowerCase();
      const r = normaliseEmailAddress(value);
      return r.ok ? r.value : value.trim().toLowerCase();
    }
    case 'phone':
    case 'phone_list': {
      if (typeof value !== 'string' || !value.trim()) return undefined;
      if (op === 'contains') {
        const digits = value.replace(/\D/g, '');
        return digits || undefined;
      }
      const r = normalisePhone(value);
      return r.ok ? r.value : undefined;
    }
    default:
      return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}

function asList(v: unknown): unknown[] {
  if (v === null || v === undefined || v === '') return [];
  return Array.isArray(v) ? v : [v];
}

function datePart(v: unknown): string | null {
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return null;
}

/**
 * Reference evaluator for filter semantics. The API translates the same conditions
 * to SQL; integration tests check the two agree.
 */
export function matchesConditions(
  record: Record<string, unknown>,
  fields: readonly FilterFieldDef[],
  conditions: readonly FilterCondition[],
  now = new Date(),
): boolean {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  return conditions.every((c) => {
    const def = byKey.get(c.field);
    if (!def) return false;
    const values = asList(record[c.field]);
    if (c.op === 'empty') return values.length === 0;
    if (c.op === 'not_empty') return values.length > 0;
    const target = c.value;
    switch (def.kind) {
      case 'date':
      case 'datetime': {
        const d = datePart(values[0]);
        if (!d) return false;
        if (c.op === 'is') return d === target;
        if (c.op === 'before') return d < String(target);
        if (c.op === 'after') return d > String(target);
        if (c.op === 'in_last_days') {
          const since = new Date(now.getTime() - Number(target) * 86_400_000);
          const at = values[0] instanceof Date ? values[0] : new Date(String(values[0]));
          return at.getTime() >= since.getTime() && at.getTime() <= now.getTime();
        }
        return false;
      }
      case 'phone':
      case 'phone_list':
        if (c.op === 'contains') return values.some((v) => String(v).replace(/\D/g, '').includes(String(target)));
        if (c.op === 'is') return values.some((v) => v === target);
        return !values.some((v) => v === target);
      case 'text':
      case 'email':
      case 'text_list':
      case 'email_list': {
        const t = String(target).toLowerCase();
        const lower = values.map((v) => String(v).toLowerCase());
        if (c.op === 'contains') return lower.some((v) => v.includes(t));
        if (c.op === 'is') return lower.some((v) => v === t);
        return !lower.some((v) => v === t);
      }
      default: {
        if (c.op === 'is') return values.some((v) => v === target);
        if (c.op === 'is_not') return !values.some((v) => v === target);
        return false;
      }
    }
  });
}
