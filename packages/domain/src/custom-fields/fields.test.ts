import { describe, expect, it } from 'vitest';
import { removedOptionValues, validateFieldDefinition, validateFieldValue, type CustomFieldDef } from './fields.js';

const def = (type: CustomFieldDef['type'], options: CustomFieldDef['options'] = []) => ({ name: 'F', type, options });
const opts = [
  { value: 'gold', label: 'Gold', sort: 1 },
  { value: 'silver', label: 'Silver', sort: 2 },
];

describe('custom field values (spec 7.3)', () => {
  it('empty values clear the field', () => {
    expect(validateFieldValue(def('text'), '')).toEqual({ ok: true, value: null });
    expect(validateFieldValue(def('multiselect', opts), [])).toEqual({ ok: true, value: [] });
  });
  it('text is trimmed; multi-line text is kept as typed', () => {
    expect(validateFieldValue(def('text'), '  hi ')).toEqual({ ok: true, value: 'hi' });
    expect(validateFieldValue(def('textarea'), ' a\nb ')).toEqual({ ok: true, value: ' a\nb ' });
  });
  it('numbers accept numeric strings and reject others', () => {
    expect(validateFieldValue(def('number'), '12.5')).toEqual({ ok: true, value: 12.5 });
    expect(validateFieldValue(def('number'), 'abc')).toMatchObject({ ok: false });
  });
  it('dates must be real calendar dates', () => {
    expect(validateFieldValue(def('date'), '2026-02-28')).toEqual({ ok: true, value: '2026-02-28' });
    expect(validateFieldValue(def('date'), '2026-02-30')).toMatchObject({ ok: false });
    expect(validateFieldValue(def('date'), '28/02/2026')).toMatchObject({ ok: false });
  });
  it('date-times are stored as UTC ISO strings', () => {
    expect(validateFieldValue(def('datetime'), '2026-07-01T10:00:00+01:00')).toEqual({
      ok: true,
      value: '2026-07-01T09:00:00.000Z',
    });
  });
  it('select, radio and multi-select accept only defined options', () => {
    expect(validateFieldValue(def('select', opts), 'gold')).toEqual({ ok: true, value: 'gold' });
    expect(validateFieldValue(def('radio', opts), 'bronze')).toMatchObject({ ok: false });
    expect(validateFieldValue(def('multiselect', opts), ['gold', 'gold', 'silver'])).toEqual({
      ok: true,
      value: ['gold', 'silver'],
    });
    expect(validateFieldValue(def('multiselect', opts), ['gold', 'bronze'])).toMatchObject({ ok: false });
  });
  it('checkboxes must be booleans', () => {
    expect(validateFieldValue(def('checkbox'), true)).toEqual({ ok: true, value: true });
    expect(validateFieldValue(def('checkbox'), 'yes')).toMatchObject({ ok: false });
  });
  it('email and phone custom fields are normalised like contact fields', () => {
    expect(validateFieldValue(def('email'), ' A@B.COM ')).toEqual({ ok: true, value: 'a@b.com' });
    expect(validateFieldValue(def('phone'), '07911 123456')).toEqual({ ok: true, value: '+447911123456' });
  });
  it('URLs must be http or https', () => {
    expect(validateFieldValue(def('url'), 'https://example.com/x')).toEqual({
      ok: true,
      value: 'https://example.com/x',
    });
    expect(validateFieldValue(def('url'), 'javascript:alert(1)')).toMatchObject({ ok: false });
  });
  it('user and contact pickers store ids', () => {
    expect(validateFieldValue(def('user'), '0B1E2D3C-0000-4000-8000-000000000000')).toEqual({
      ok: true,
      value: '0b1e2d3c-0000-4000-8000-000000000000',
    });
    expect(validateFieldValue(def('contact'), 'nope')).toMatchObject({ ok: false });
  });
});

describe('custom field definitions (spec 7.3)', () => {
  const base = { key: 'tier', name: 'Tier', type: 'select' as const, options: opts, defaultValue: null };
  it('a valid definition passes', () => {
    expect(validateFieldDefinition(base)).toEqual({ ok: true });
  });
  it('when the internal key is changed, the system refuses (keys are immutable)', () => {
    expect(validateFieldDefinition({ ...base, key: 'level' }, { key: 'tier', type: 'select' })).toMatchObject({
      ok: false,
    });
  });
  it('when the type is changed, the system refuses', () => {
    expect(validateFieldDefinition(base, { key: 'tier', type: 'radio' })).toMatchObject({ ok: false });
  });
  it('keys must be lower-case identifiers', () => {
    expect(validateFieldDefinition({ ...base, key: 'Tier Level' })).toMatchObject({ ok: false });
  });
  it('option fields need unique options; other types have none', () => {
    expect(validateFieldDefinition({ ...base, options: [] })).toMatchObject({ ok: false });
    expect(validateFieldDefinition({ ...base, options: [...opts, opts[0]!] })).toMatchObject({ ok: false });
    expect(validateFieldDefinition({ ...base, type: 'text', options: opts })).toMatchObject({ ok: false });
  });
  it('the default value must be valid for the field', () => {
    expect(validateFieldDefinition({ ...base, defaultValue: 'gold' })).toEqual({ ok: true });
    expect(validateFieldDefinition({ ...base, defaultValue: 'bronze' })).toMatchObject({ ok: false });
  });
  it('when an option is removed or its value changed, it is reported for the usage warning', () => {
    expect(
      removedOptionValues(opts, [
        { value: 'gold', label: 'Gold!', sort: 1 },
        { value: 'plat', label: 'Platinum', sort: 3 },
      ]),
    ).toEqual(['silver']);
    expect(removedOptionValues(opts, opts)).toEqual([]);
  });
});
