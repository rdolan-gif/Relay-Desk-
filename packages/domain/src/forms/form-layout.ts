import { isEmptyValue, validateFieldValue, type CustomFieldDef, type FieldValue } from '../custom-fields/fields.js';

/** Show a field only when another field has a given value (spec 7.4, "dynamic visibility"). */
export interface VisibilityRule {
  fieldId: string;
  /** Visible when the controlling field equals this value (or contains it, for multi-select). */
  equals: string | number | boolean;
}

export interface FieldPlacement {
  fieldId: string;
  tooltip?: string;
  /** Hidden from agents: not shown in the form and not editable through it. */
  hidden?: boolean;
  readOnly?: boolean;
  required?: boolean;
  /** Visible rows for multi-line text. */
  rows?: number;
  visibleWhen?: VisibilityRule;
}

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  collapsed?: boolean;
  fields: FieldPlacement[];
}

/** One layout format for category, contact, account and CRM record forms (spec 7.4). */
export interface FormLayout {
  sections: FormSection[];
}

export type CustomValues = Record<string, FieldValue>;

export const EMPTY_LAYOUT: FormLayout = { sections: [] };

export function layoutPlacements(layout: FormLayout): FieldPlacement[] {
  return layout.sections.flatMap((s) => s.fields);
}

/** Checks a layout before saving: known fields, each placed once, valid visibility rules. */
export function validateLayout(layout: FormLayout, fields: ReadonlyMap<string, CustomFieldDef>): string[] {
  const errors: string[] = [];
  const seenSections = new Set<string>();
  const placed = new Map<string, FieldPlacement>();
  for (const section of layout.sections) {
    if (!section.id || seenSections.has(section.id)) errors.push('Each section needs a unique id.');
    seenSections.add(section.id);
    if (!section.title.trim()) errors.push('Each section needs a title.');
    for (const p of section.fields) {
      if (!fields.has(p.fieldId)) errors.push(`Unknown field ${p.fieldId}.`);
      if (placed.has(p.fieldId)) errors.push(`Field ${fields.get(p.fieldId)?.name ?? p.fieldId} is placed twice.`);
      placed.set(p.fieldId, p);
      if (p.rows !== undefined && (!Number.isInteger(p.rows) || p.rows < 1 || p.rows > 50)) {
        errors.push('Rows must be between 1 and 50.');
      }
    }
  }
  for (const p of placed.values()) {
    if (!p.visibleWhen) continue;
    const name = fields.get(p.fieldId)?.name ?? p.fieldId;
    if (p.visibleWhen.fieldId === p.fieldId) errors.push(`${name} cannot depend on itself.`);
    else if (!placed.has(p.visibleWhen.fieldId)) errors.push(`${name} depends on a field that is not on this form.`);
    if (p.required && p.hidden) errors.push(`${name} cannot be both required and hidden.`);
  }
  // Reject visibility cycles (A shows when B, B shows when A).
  for (const start of placed.keys()) {
    const seen = new Set<string>([start]);
    let cur = placed.get(start)?.visibleWhen?.fieldId;
    while (cur) {
      if (seen.has(cur)) {
        errors.push('Visibility rules form a loop.');
        break;
      }
      seen.add(cur);
      cur = placed.get(cur)?.visibleWhen?.fieldId;
    }
  }
  return [...new Set(errors)];
}

function matchesRule(value: FieldValue | undefined, rule: VisibilityRule): boolean {
  if (Array.isArray(value)) return value.includes(String(rule.equals));
  return value === rule.equals;
}

/**
 * When a field has a visibility rule, it shows only while the controlling field has
 * the given value and is itself visible. Hidden placements never show.
 */
export function isFieldVisible(layout: FormLayout, fieldId: string, values: CustomValues): boolean {
  const byId = new Map(layoutPlacements(layout).map((p) => [p.fieldId, p]));
  const seen = new Set<string>();
  let cur = byId.get(fieldId);
  if (!cur || cur.hidden) return false;
  while (cur?.visibleWhen) {
    if (seen.has(cur.fieldId)) return false;
    seen.add(cur.fieldId);
    const rule: VisibilityRule = cur.visibleWhen;
    if (!matchesRule(values[rule.fieldId], rule)) return false;
    cur = byId.get(rule.fieldId);
    if (!cur || cur.hidden) return false;
  }
  return true;
}

export interface FormInputError {
  fieldId: string;
  code: 'unknown_field' | 'read_only' | 'invalid' | 'required';
  message: string;
}

/**
 * Applies submitted custom values to a record's stored values through a form layout.
 * - Only fields on the layout can be set; read-only and hidden fields cannot be changed.
 * - Values are validated and normalised per field type.
 * - On create, fields not submitted get their default value.
 * - Required fields must have a value while visible.
 * Values of fields not on the layout are kept untouched.
 */
export function applyFormInput(args: {
  layout: FormLayout;
  fields: ReadonlyMap<string, CustomFieldDef>;
  current: CustomValues;
  input: Record<string, unknown>;
  isCreate: boolean;
}): { ok: true; values: CustomValues } | { ok: false; errors: FormInputError[] } {
  const { layout, fields, current, input, isCreate } = args;
  const placements = new Map(layoutPlacements(layout).map((p) => [p.fieldId, p]));
  const errors: FormInputError[] = [];
  const values: CustomValues = { ...current };

  if (isCreate) {
    for (const [fieldId] of placements) {
      const def = fields.get(fieldId);
      if (def && !isEmptyValue(def.defaultValue) && values[fieldId] === undefined) {
        const r = validateFieldValue(def, def.defaultValue);
        if (r.ok) values[fieldId] = r.value;
      }
    }
  }

  for (const [fieldId, raw] of Object.entries(input)) {
    const placement = placements.get(fieldId);
    const def = fields.get(fieldId);
    if (!placement || !def) {
      errors.push({ fieldId, code: 'unknown_field', message: `Field ${fieldId} is not on this form.` });
      continue;
    }
    const r = validateFieldValue(def, raw);
    if (!r.ok) {
      errors.push({ fieldId, code: 'invalid', message: r.error });
      continue;
    }
    const before = values[fieldId] ?? (def.type === 'multiselect' ? [] : null);
    const changed = JSON.stringify(before) !== JSON.stringify(r.value);
    if (changed && (placement.readOnly || placement.hidden)) {
      errors.push({ fieldId, code: 'read_only', message: `${def.name} cannot be changed here.` });
      continue;
    }
    if (isEmptyValue(r.value)) delete values[fieldId];
    else values[fieldId] = r.value;
  }

  for (const [fieldId, placement] of placements) {
    if (!placement.required) continue;
    if (!isFieldVisible(layout, fieldId, values)) continue;
    if (isEmptyValue(values[fieldId])) {
      const name = fields.get(fieldId)?.name ?? fieldId;
      errors.push({ fieldId, code: 'required', message: `${name} is required.` });
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, values };
}
