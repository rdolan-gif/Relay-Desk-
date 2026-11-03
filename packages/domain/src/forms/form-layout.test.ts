import { describe, expect, it } from 'vitest';
import type { CustomFieldDef } from '../custom-fields/fields.js';
import { applyFormInput, isFieldVisible, validateLayout, type FormLayout } from './form-layout.js';

const f = (id: string, type: CustomFieldDef['type'], extra: Partial<CustomFieldDef> = {}): CustomFieldDef => ({
  id,
  key: id,
  name: id.toUpperCase(),
  type,
  options: [],
  defaultValue: null,
  ...extra,
});
const fields = new Map<string, CustomFieldDef>([
  [
    'kind',
    f('kind', 'select', {
      options: [
        { value: 'business', label: 'Business', sort: 1 },
        { value: 'home', label: 'Home', sort: 2 },
      ],
    }),
  ],
  ['vat', f('vat', 'text')],
  ['vat_note', f('vat_note', 'text')],
  ['notes', f('notes', 'textarea')],
  ['source', f('source', 'text', { defaultValue: 'web' })],
  ['score', f('score', 'number')],
  ['secret', f('secret', 'text')],
]);
const layout: FormLayout = {
  sections: [
    {
      id: 's1',
      title: 'Main',
      fields: [
        { fieldId: 'kind', required: true },
        { fieldId: 'vat', required: true, visibleWhen: { fieldId: 'kind', equals: 'business' } },
        { fieldId: 'vat_note', visibleWhen: { fieldId: 'vat', equals: 'GB123' } },
        { fieldId: 'source' },
      ],
    },
    {
      id: 's2',
      title: 'More',
      collapsed: true,
      fields: [
        { fieldId: 'notes', rows: 4 },
        { fieldId: 'score', readOnly: true },
        { fieldId: 'secret', hidden: true },
      ],
    },
  ],
};

describe('form layout validation (spec 7.4)', () => {
  it('a valid layout has no errors', () => {
    expect(validateLayout(layout, fields)).toEqual([]);
  });
  it('rejects unknown fields and fields placed twice', () => {
    const bad: FormLayout = {
      sections: [{ id: 'a', title: 'A', fields: [{ fieldId: 'nope' }, { fieldId: 'vat' }, { fieldId: 'vat' }] }],
    };
    const errors = validateLayout(bad, fields);
    expect(errors.some((e) => e.includes('Unknown field'))).toBe(true);
    expect(errors.some((e) => e.includes('placed twice'))).toBe(true);
  });
  it('rejects visibility rules on fields not on the form, self-references and loops', () => {
    const missing: FormLayout = {
      sections: [{ id: 'a', title: 'A', fields: [{ fieldId: 'vat', visibleWhen: { fieldId: 'kind', equals: 'x' } }] }],
    };
    expect(validateLayout(missing, fields).join()).toMatch(/not on this form/);
    const loop: FormLayout = {
      sections: [
        {
          id: 'a',
          title: 'A',
          fields: [
            { fieldId: 'vat', visibleWhen: { fieldId: 'kind', equals: 'x' } },
            { fieldId: 'kind', visibleWhen: { fieldId: 'vat', equals: 'y' } },
          ],
        },
      ],
    };
    expect(validateLayout(loop, fields).join()).toMatch(/loop/);
  });
  it('rejects duplicate section ids and fields both required and hidden', () => {
    const bad: FormLayout = {
      sections: [
        {
          id: 'a',
          title: 'A',
          fields: [
            { fieldId: 'vat', required: true, hidden: true, visibleWhen: { fieldId: 'kind', equals: 'x' } },
            { fieldId: 'kind' },
          ],
        },
        { id: 'a', title: 'B', fields: [] },
      ],
    };
    const errors = validateLayout(bad, fields).join(' ');
    expect(errors).toMatch(/unique id/);
    expect(errors).toMatch(/required and hidden/);
  });
});

describe('dynamic visibility (spec 7.4)', () => {
  it('when the controlling field has the given value, the dependent field is visible', () => {
    expect(isFieldVisible(layout, 'vat', { kind: 'business' })).toBe(true);
    expect(isFieldVisible(layout, 'vat', { kind: 'home' })).toBe(false);
  });
  it('when the controlling field is itself not visible, the dependent field is not visible', () => {
    expect(isFieldVisible(layout, 'vat_note', { kind: 'home', vat: 'GB123' })).toBe(false);
    expect(isFieldVisible(layout, 'vat_note', { kind: 'business', vat: 'GB123' })).toBe(true);
  });
  it('hidden placements are never visible', () => {
    expect(isFieldVisible(layout, 'secret', {})).toBe(false);
  });
});

describe('applying form input (spec 7.4)', () => {
  it('on create, fields not submitted get their default value', () => {
    const r = applyFormInput({ layout, fields, current: {}, input: { kind: 'home' }, isCreate: true });
    expect(r).toEqual({ ok: true, values: { kind: 'home', source: 'web' } });
  });
  it('when a required field is empty, the system refuses', () => {
    const r = applyFormInput({ layout, fields, current: {}, input: {}, isCreate: true });
    expect(r).toMatchObject({ ok: false, errors: [{ fieldId: 'kind', code: 'required' }] });
  });
  it('a required field that is hidden by a visibility rule is not required', () => {
    const r = applyFormInput({ layout, fields, current: {}, input: { kind: 'home' }, isCreate: false });
    expect(r.ok).toBe(true);
    const r2 = applyFormInput({ layout, fields, current: {}, input: { kind: 'business' }, isCreate: false });
    expect(r2).toMatchObject({ ok: false, errors: [{ fieldId: 'vat', code: 'required' }] });
  });
  it('when a read-only or hidden field is changed through the form, the system refuses', () => {
    const r = applyFormInput({
      layout,
      fields,
      current: { kind: 'home', score: 1 },
      input: { score: 2, secret: 'x' },
      isCreate: false,
    });
    expect(r).toMatchObject({
      ok: false,
      errors: [
        { fieldId: 'score', code: 'read_only' },
        { fieldId: 'secret', code: 'read_only' },
      ],
    });
  });
  it('resubmitting a read-only field unchanged is allowed', () => {
    const r = applyFormInput({
      layout,
      fields,
      current: { kind: 'home', score: 1 },
      input: { score: 1 },
      isCreate: false,
    });
    expect(r.ok).toBe(true);
  });
  it('when a field is not on the form, the system refuses it', () => {
    const r = applyFormInput({ layout, fields, current: { kind: 'home' }, input: { other: 1 }, isCreate: false });
    expect(r).toMatchObject({ ok: false, errors: [{ code: 'unknown_field' }] });
  });
  it('invalid values are reported; empty values clear the field; values off the layout are kept', () => {
    const bad = applyFormInput({
      layout,
      fields,
      current: { kind: 'home' },
      input: { kind: 'castle' },
      isCreate: false,
    });
    expect(bad).toMatchObject({ ok: false, errors: [{ code: 'invalid' }] });
    const ok = applyFormInput({
      layout,
      fields,
      current: { kind: 'home', notes: 'x', legacy: 'keep' },
      input: { notes: '' },
      isCreate: false,
    });
    expect(ok).toEqual({ ok: true, values: { kind: 'home', legacy: 'keep' } });
  });
});
