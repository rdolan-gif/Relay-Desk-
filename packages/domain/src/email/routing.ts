import type { Priority, TicketState } from '../tickets/state.js';

export const ROUTING_FIELDS = [
  'from',
  'from_domain',
  'to',
  'cc',
  'subject',
  'body',
  'queue',
  'has_attachment',
  'contact_field',
  'account_field',
] as const;
export type RoutingField = (typeof ROUTING_FIELDS)[number];
export const ROUTING_OPS = ['equals', 'contains', 'starts_with', 'ends_with', 'regex', 'is_empty'] as const;
export type RoutingOp = (typeof ROUTING_OPS)[number];

export interface RoutingCondition {
  field: RoutingField;
  op: RoutingOp;
  value?: string;
  /** For contact_field / account_field: the custom field id. */
  fieldId?: string;
  negate?: boolean;
}

export interface RoutingActions {
  categoryId?: string;
  userId?: string | null;
  statusIds?: string[];
  state?: TicketState;
  priority?: Priority;
  /** Custom values by field id; applied only if the final category's form has the field. */
  customFields?: Record<string, unknown>;
}

export interface RoutingRule {
  id: string;
  title: string;
  direction: 'incoming' | 'outgoing' | 'both';
  active: boolean;
  /** Every condition in `all` must match, and at least one in `any` (if any are given). */
  all: RoutingCondition[];
  any: RoutingCondition[];
  actions: RoutingActions;
}

/** The email facts rules can look at. Addresses are lower-case. */
export interface RoutingInput {
  direction: 'incoming' | 'outgoing';
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  queueId: string;
  hasAttachment: boolean;
  contactFields: Record<string, unknown>;
  accountFields: Record<string, unknown>;
}

const MAX_REGEX = 500;

function values(c: RoutingCondition, input: RoutingInput): string[] {
  switch (c.field) {
    case 'from':
      return [input.from];
    case 'from_domain':
      return [input.from.split('@')[1] ?? ''];
    case 'to':
      return input.to;
    case 'cc':
      return input.cc;
    case 'subject':
      return [input.subject];
    case 'body':
      return [input.body];
    case 'queue':
      return [input.queueId];
    case 'has_attachment':
      return [input.hasAttachment ? 'true' : 'false'];
    case 'contact_field':
    case 'account_field': {
      const v = (c.field === 'contact_field' ? input.contactFields : input.accountFields)[c.fieldId ?? ''];
      if (v === null || v === undefined) return [];
      return Array.isArray(v) ? v.map(String) : [String(v)];
    }
  }
}

/** Case-insensitive match of one condition. Invalid regexes never match. */
export function conditionMatches(c: RoutingCondition, input: RoutingInput): boolean {
  const vs = values(c, input).map((v) => v.toLowerCase());
  const target = (c.value ?? '').toLowerCase();
  let hit: boolean;
  switch (c.op) {
    case 'is_empty':
      hit = vs.length === 0 || vs.every((v) => v.trim() === '');
      break;
    case 'equals':
      hit = vs.some((v) => v === target);
      break;
    case 'contains':
      hit = vs.some((v) => v.includes(target));
      break;
    case 'starts_with':
      hit = vs.some((v) => v.startsWith(target));
      break;
    case 'ends_with':
      hit = vs.some((v) => v.endsWith(target));
      break;
    case 'regex': {
      try {
        if ((c.value ?? '').length > MAX_REGEX) return false;
        const re = new RegExp(c.value ?? '', 'i');
        hit = values(c, input).some((v) => re.test(v));
      } catch {
        hit = false;
      }
      break;
    }
  }
  return c.negate ? !hit : hit;
}

export function ruleMatches(rule: RoutingRule, input: RoutingInput): boolean {
  if (!rule.active) return false;
  if (rule.direction !== 'both' && rule.direction !== input.direction) return false;
  if (rule.all.length === 0 && rule.any.length === 0) return false;
  if (!rule.all.every((c) => conditionMatches(c, input))) return false;
  if (rule.any.length && !rule.any.some((c) => conditionMatches(c, input))) return false;
  return true;
}

export interface RoutingResult {
  actions: RoutingActions;
  matchedRuleIds: string[];
}

/**
 * Applies every matching rule in order (owner answer S-3): later rules overwrite
 * fields set by earlier ones; custom values accumulate.
 */
export function applyRoutingRules(rules: readonly RoutingRule[], input: RoutingInput): RoutingResult {
  const actions: RoutingActions = {};
  const matchedRuleIds: string[] = [];
  for (const rule of rules) {
    if (!ruleMatches(rule, input)) continue;
    matchedRuleIds.push(rule.id);
    const a = rule.actions;
    if (a.categoryId !== undefined) actions.categoryId = a.categoryId;
    if (a.userId !== undefined) actions.userId = a.userId;
    if (a.statusIds !== undefined) actions.statusIds = a.statusIds;
    if (a.state !== undefined) actions.state = a.state;
    if (a.priority !== undefined) actions.priority = a.priority;
    if (a.customFields) actions.customFields = { ...(actions.customFields ?? {}), ...a.customFields };
  }
  return { actions, matchedRuleIds };
}

/** Rule regexes are validated on save so a broken one can't be stored. */
export function validateRule(rule: Pick<RoutingRule, 'title' | 'all' | 'any'>): string[] {
  const errors: string[] = [];
  if (!rule.title.trim()) errors.push('Give the rule a title.');
  if (rule.all.length + rule.any.length === 0) errors.push('Add at least one condition.');
  for (const c of [...rule.all, ...rule.any]) {
    if (c.op === 'regex') {
      try {
        if ((c.value ?? '').length > MAX_REGEX) throw new Error('too long');
        new RegExp(c.value ?? '');
      } catch {
        errors.push(`"${c.value}" is not a valid pattern.`);
      }
    } else if (c.op !== 'is_empty' && !(c.value ?? '').trim()) {
      errors.push('Each condition needs a value.');
    }
    if ((c.field === 'contact_field' || c.field === 'account_field') && !c.fieldId)
      errors.push('Choose which field to check.');
  }
  return [...new Set(errors)];
}
