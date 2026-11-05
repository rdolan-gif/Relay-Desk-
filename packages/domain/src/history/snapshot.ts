import type { FieldChange } from '../audit/audit-events.js';

export interface HistoryRecord {
  action: 'create' | 'update' | 'delete' | 'restore' | 'merge' | 'move' | 'anonymise';
  changes: FieldChange[];
  createdAt: Date;
}

/**
 * Reconstructs an entity's flat state as it was at time `at` by reverse-applying every
 * change made after it (spec 12.2, "History / snapshots"). Returns null if the entity
 * did not exist yet at `at`.
 */
export function stateAt(
  current: Record<string, unknown>,
  history: readonly HistoryRecord[],
  at: Date,
): Record<string, unknown> | null {
  const later = history
    .filter((h) => h.createdAt.getTime() > at.getTime())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const state: Record<string, unknown> = { ...current };
  for (const entry of later) {
    if (entry.action === 'create') return null;
    for (const c of entry.changes) {
      if (c.old === null || c.old === undefined) delete state[c.field];
      else state[c.field] = c.old;
    }
  }
  return state;
}

/**
 * Flattens an entity with custom values into one level for diffing and snapshots:
 * custom values become `custom.<fieldId>`.
 */
export function flattenForHistory(
  core: Record<string, unknown>,
  custom: Record<string, unknown>,
): Record<string, unknown> {
  const flat: Record<string, unknown> = { ...core };
  for (const [k, v] of Object.entries(custom)) flat[`custom.${k}`] = v;
  return flat;
}

export function unflattenFromHistory(flat: Record<string, unknown>): {
  core: Record<string, unknown>;
  custom: Record<string, unknown>;
} {
  const core: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) {
    if (k.startsWith('custom.')) custom[k.slice(7)] = v;
    else core[k] = v;
  }
  return { core, custom };
}
