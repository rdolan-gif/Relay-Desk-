import { describe, expect, it } from 'vitest';
import { matchesConditions, validateConditions, type FilterFieldDef } from './filters.js';

const fields: FilterFieldDef[] = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'emails', label: 'Emails', kind: 'email_list' },
  { key: 'phones', label: 'Phones', kind: 'phone_list' },
  { key: 'createdAt', label: 'Created', kind: 'datetime' },
  { key: 'custom.tier', label: 'Tier', kind: 'option' },
  { key: 'custom.tags', label: 'Tags', kind: 'option_list' },
  { key: 'custom.vip', label: 'VIP', kind: 'boolean' },
  { key: 'custom.score', label: 'Score', kind: 'number' },
  { key: 'custom.dob', label: 'Date of birth', kind: 'date' },
];
const now = new Date('2026-11-03T12:00:00Z');
const sam = {
  name: 'Sam Smith',
  emails: ['sam@example.com', 'sam.work@acme.co.uk'],
  phones: ['+447911123456'],
  createdAt: new Date('2026-10-30T09:00:00Z'),
  'custom.tier': 'gold',
  'custom.tags': ['newsletter', 'beta'],
  'custom.vip': true,
  'custom.score': 7,
  'custom.dob': '1990-05-01',
};
const match = (conds: Parameters<typeof validateConditions>[1], record: Record<string, unknown> = sam) => {
  const v = validateConditions(fields, conds);
  if (!v.ok) throw new Error(v.errors.join());
  return matchesConditions(record, fields, v.conditions, now);
};

describe('filter validation (spec 6.1, 14)', () => {
  it('rejects unknown fields, unavailable operators and missing values', () => {
    const r = validateConditions(fields, [
      { field: 'nope', op: 'is', value: 'x' },
      { field: 'custom.vip', op: 'contains', value: 'x' },
      { field: 'name', op: 'is' },
    ]);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.errors).toHaveLength(3);
  });
  it('normalises email and phone values so they match stored values', () => {
    expect(validateConditions(fields, [{ field: 'emails', op: 'is', value: ' SAM@Example.com' }])).toEqual({
      ok: true,
      conditions: [{ field: 'emails', op: 'is', value: 'sam@example.com' }],
    });
    expect(validateConditions(fields, [{ field: 'phones', op: 'is', value: '07911 123456' }])).toEqual({
      ok: true,
      conditions: [{ field: 'phones', op: 'is', value: '+447911123456' }],
    });
  });
  it('"in last N days" needs a positive whole number', () => {
    expect(validateConditions(fields, [{ field: 'createdAt', op: 'in_last_days', value: 0 }])).toMatchObject({
      ok: false,
    });
    expect(validateConditions(fields, [{ field: 'createdAt', op: 'in_last_days', value: '7' }])).toMatchObject({
      ok: true,
    });
  });
});

describe('filter semantics (spec 6.1, 14)', () => {
  it('text: is / is not / contains are case-insensitive', () => {
    expect(match([{ field: 'name', op: 'is', value: 'sam smith' }])).toBe(true);
    expect(match([{ field: 'name', op: 'is_not', value: 'sam smith' }])).toBe(false);
    expect(match([{ field: 'name', op: 'contains', value: 'SMI' }])).toBe(true);
  });
  it('lists: is matches any element; contains matches any element', () => {
    expect(match([{ field: 'emails', op: 'is', value: 'SAM.WORK@acme.co.uk' }])).toBe(true);
    expect(match([{ field: 'emails', op: 'contains', value: 'acme' }])).toBe(true);
    expect(match([{ field: 'emails', op: 'is_not', value: 'sam@example.com' }])).toBe(false);
  });
  it('phones: contains matches digits regardless of formatting', () => {
    expect(match([{ field: 'phones', op: 'contains', value: '123 456' }])).toBe(true);
    expect(match([{ field: 'phones', op: 'is', value: '+44 7911 123456' }])).toBe(true);
  });
  it('empty / not empty', () => {
    expect(match([{ field: 'phones', op: 'not_empty' }])).toBe(true);
    expect(match([{ field: 'phones', op: 'empty' }], { ...sam, phones: [] })).toBe(true);
    expect(match([{ field: 'custom.tier', op: 'empty' }], { ...sam, 'custom.tier': null })).toBe(true);
  });
  it('dates: before / after / is / in last N days', () => {
    expect(match([{ field: 'createdAt', op: 'after', value: '2026-10-29' }])).toBe(true);
    expect(match([{ field: 'createdAt', op: 'before', value: '2026-10-30' }])).toBe(false);
    expect(match([{ field: 'createdAt', op: 'is', value: '2026-10-30' }])).toBe(true);
    expect(match([{ field: 'createdAt', op: 'in_last_days', value: 7 }])).toBe(true);
    expect(match([{ field: 'createdAt', op: 'in_last_days', value: 2 }])).toBe(false);
    expect(match([{ field: 'custom.dob', op: 'before', value: '2000-01-01' }])).toBe(true);
  });
  it('options, multi-select, booleans and numbers', () => {
    expect(match([{ field: 'custom.tier', op: 'is', value: 'gold' }])).toBe(true);
    expect(match([{ field: 'custom.tags', op: 'is', value: 'beta' }])).toBe(true);
    expect(match([{ field: 'custom.tags', op: 'is_not', value: 'beta' }])).toBe(false);
    expect(match([{ field: 'custom.vip', op: 'is', value: 'true' }])).toBe(true);
    expect(match([{ field: 'custom.score', op: 'is', value: '7' }])).toBe(true);
  });
  it('all conditions must match', () => {
    expect(
      match([
        { field: 'name', op: 'contains', value: 'sam' },
        { field: 'custom.tier', op: 'is', value: 'silver' },
      ]),
    ).toBe(false);
  });
});
