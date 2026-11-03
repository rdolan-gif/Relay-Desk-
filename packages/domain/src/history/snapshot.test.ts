import { describe, expect, it } from 'vitest';
import { flattenForHistory, stateAt, unflattenFromHistory, type HistoryRecord } from './snapshot.js';

const t = (s: string) => new Date(`2026-11-0${s}T12:00:00Z`);
const history: HistoryRecord[] = [
  {
    action: 'create',
    createdAt: t('1'),
    changes: [
      { field: 'name', old: null, new: 'Sam' },
      { field: 'custom.tier', old: null, new: 'silver' },
    ],
  },
  { action: 'update', createdAt: t('2'), changes: [{ field: 'name', old: 'Sam', new: 'Samantha' }] },
  {
    action: 'update',
    createdAt: t('3'),
    changes: [
      { field: 'custom.tier', old: 'silver', new: 'gold' },
      { field: 'custom.vip', old: null, new: true },
    ],
  },
];
const current = { name: 'Samantha', 'custom.tier': 'gold', 'custom.vip': true };

describe('history snapshots (spec 12.2)', () => {
  it('the form can be viewed as it was at any past point', () => {
    expect(stateAt(current, history, new Date('2026-11-02T18:00:00Z'))).toEqual({
      name: 'Samantha',
      'custom.tier': 'silver',
    });
    expect(stateAt(current, history, new Date('2026-11-01T18:00:00Z'))).toEqual({
      name: 'Sam',
      'custom.tier': 'silver',
    });
  });
  it('at or after the latest change, the snapshot equals the current state', () => {
    expect(stateAt(current, history, t('3'))).toEqual(current);
  });
  it('before creation there is no snapshot', () => {
    expect(stateAt(current, history, new Date('2026-10-31T00:00:00Z'))).toBeNull();
  });
  it('custom values flatten to custom.<id> and back', () => {
    const flat = flattenForHistory({ name: 'A' }, { f1: 'x' });
    expect(flat).toEqual({ name: 'A', 'custom.f1': 'x' });
    expect(unflattenFromHistory(flat)).toEqual({ core: { name: 'A' }, custom: { f1: 'x' } });
  });
});
