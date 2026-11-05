import type { Priority, TicketState } from '../tickets/state.js';
import type { TimeGroup } from '../sla/working-time.js';
import { localParts, toMinutes, zonedTime } from '../sla/working-time.js';

/**
 * Macros (spec 10): an ordered list of actions run with one click. Field actions change the
 * form; Save / Don't save / Back / Delete, Insert template and Open URL are steps the
 * screen carries out in order, stopping if a save fails validation.
 */
export type MacroAction =
  | { type: 'set_category'; categoryId: string }
  | { type: 'set_user'; userId: string | null; replace: boolean }
  | { type: 'set_state'; state: TicketState }
  | { type: 'set_status'; statusIds: string[]; mode: 'add' | 'replace' }
  | { type: 'set_priority'; priority: Priority }
  | { type: 'set_reopen'; mode: 'relative'; amount: number; unit: 'hours' | 'days' | 'working_days' }
  | { type: 'set_reopen'; mode: 'absolute'; at: string }
  | { type: 'set_custom_field'; fieldId: string; value: unknown }
  | { type: 'add_follower'; userId: string }
  | { type: 'insert_template'; templateId: string }
  | { type: 'open_url'; url: string }
  | { type: 'save' }
  | { type: 'dont_save' }
  | { type: 'back' }
  | { type: 'delete' };

export type MacroActionType = MacroAction['type'];
export const MACRO_ACTION_TYPES: MacroActionType[] = [
  'set_category',
  'set_user',
  'set_state',
  'set_status',
  'set_priority',
  'set_reopen',
  'set_custom_field',
  'add_follower',
  'insert_template',
  'open_url',
  'save',
  'dont_save',
  'back',
  'delete',
];
export type MacroPosition = 'hidden' | 'menu' | 'button';

/** "The current user" in Set user / Add follower. */
export const ME = '@me';

export interface MacroForm {
  categoryId: string;
  userId: string | null;
  state: TicketState;
  statusIds: string[];
  priority: Priority;
  reopenAt: string | null;
  followerIds: string[];
  customFields: Record<string, unknown>;
}

const FIELD_ACTIONS = new Set<MacroActionType>([
  'set_category',
  'set_user',
  'set_state',
  'set_status',
  'set_priority',
  'set_reopen',
  'set_custom_field',
  'add_follower',
]);
export const isFieldAction = (a: MacroAction) => FIELD_ACTIONS.has(a.type);
const ENDS = new Set<MacroActionType>(['back', 'delete']);

const pad = (n: number) => String(n).padStart(2, '0');

/** Adds whole working days: same time of day, skipping closed days of the time group (Mon–Fri if none). */
export function addWorkingDays(from: Date, days: number, tg: TimeGroup | null): Date {
  const tz = tg?.timezone ?? 'Europe/London';
  const p = localParts(from, tz);
  const minutes = p.hour * 60 + p.minute;
  let d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  let left = days;
  for (let guard = 0; left > 0 && guard < 3660; guard++) {
    d = new Date(d.getTime() + 86_400_000);
    const iso = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const weekday = (d.getUTCDay() + 6) % 7;
    let open: boolean;
    if (tg) {
      const ex = tg.exceptions.find((e) => e.date === iso);
      const intervals = ex ? (ex.intervals ?? []) : (tg.week[weekday] ?? []);
      open = intervals.some((i) => toMinutes(i.end) > toMinutes(i.start));
    } else open = weekday < 5;
    if (open) left--;
  }
  return new Date(zonedTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), minutes, tz));
}

/** Applies one field action to the form. */
export function applyMacroAction(
  form: MacroForm,
  a: MacroAction,
  ctx: { userId: string; now: Date; timeGroup: TimeGroup | null },
): MacroForm {
  const me = (id: string | null) => (id === ME ? ctx.userId : id);
  switch (a.type) {
    case 'set_category':
      return { ...form, categoryId: a.categoryId };
    case 'set_user':
      return a.replace || !form.userId ? { ...form, userId: me(a.userId) } : form;
    case 'set_state':
      return { ...form, state: a.state };
    case 'set_status':
      return {
        ...form,
        statusIds: a.mode === 'replace' ? [...a.statusIds] : [...new Set([...form.statusIds, ...a.statusIds])],
      };
    case 'set_priority':
      return { ...form, priority: a.priority };
    case 'set_reopen': {
      if (a.mode === 'absolute') return { ...form, reopenAt: new Date(a.at).toISOString() };
      const at =
        a.unit === 'hours'
          ? new Date(ctx.now.getTime() + a.amount * 3_600_000)
          : a.unit === 'days'
            ? new Date(ctx.now.getTime() + a.amount * 86_400_000)
            : addWorkingDays(ctx.now, a.amount, ctx.timeGroup);
      return { ...form, reopenAt: at.toISOString() };
    }
    case 'set_custom_field':
      return { ...form, customFields: { ...form.customFields, [a.fieldId]: a.value } };
    case 'add_follower': {
      const id = me(a.userId)!;
      return form.followerIds.includes(id) ? form : { ...form, followerIds: [...form.followerIds, id] };
    }
    default:
      return form;
  }
}

/** Runs all field actions (for previews and tests); steps are returned in order. */
export function runMacro(
  form: MacroForm,
  actions: MacroAction[],
  ctx: { userId: string; now: Date; timeGroup: TimeGroup | null },
): { form: MacroForm; steps: MacroAction[] } {
  let f = form;
  const steps: MacroAction[] = [];
  for (const a of actions) {
    if (isFieldAction(a)) f = applyMacroAction(f, a, ctx);
    else steps.push(a);
    if (ENDS.has(a.type)) break;
  }
  return { form: f, steps };
}

/** Fills {id}, {title}, {contact.name}… in an Open URL action, URL-encoding each value. */
export function renderMacroUrl(url: string, values: Record<string, string | number | null | undefined>): string {
  return url.replace(/\{([a-z_.]+)\}/gi, (_, key: string) => encodeURIComponent(String(values[key] ?? '')));
}

export function validateMacro(m: { title: string; actions: MacroAction[] }): string[] {
  const errors: string[] = [];
  if (!m.title.trim()) errors.push('Give the macro a title.');
  if (!m.actions.length) errors.push('Add at least one action.');
  m.actions.forEach((a, i) => {
    const n = i + 1;
    if (ENDS.has(a.type) && i !== m.actions.length - 1)
      errors.push(`Action ${n}: Back and Delete must be the last action.`);
    if (a.type === 'set_status' && !a.statusIds.length) errors.push(`Action ${n}: choose at least one status.`);
    if (a.type === 'set_reopen' && a.mode === 'relative' && !(a.amount > 0))
      errors.push(`Action ${n}: the re-open time must be more than 0.`);
    if (a.type === 'set_reopen' && a.mode === 'absolute' && Number.isNaN(Date.parse(a.at)))
      errors.push(`Action ${n}: choose a re-open date.`);
    if (a.type === 'open_url' && !/^https?:\/\//i.test(a.url))
      errors.push(`Action ${n}: the URL must start with http:// or https://.`);
  });
  return errors;
}
