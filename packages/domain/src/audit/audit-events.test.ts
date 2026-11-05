import { describe, expect, it } from 'vitest';
import { diffFields } from './audit-events.js';

describe('audit diff (spec 17)', () => {
  it('reports only changed fields with old and new values', () => {
    expect(diffFields({ a: 1, b: 'x', c: [1] }, { a: 2, b: 'x', c: [1] })).toEqual([{ field: 'a', old: 1, new: 2 }]);
  });
  it('reports added and removed fields with null for the missing side', () => {
    expect(diffFields({ a: 1 }, { b: 2 })).toEqual([
      { field: 'a', old: 1, new: null },
      { field: 'b', old: null, new: 2 },
    ]);
  });
  it('compares nested objects structurally regardless of key order', () => {
    expect(diffFields({ m: { x: 1, y: 2 } }, { m: { y: 2, x: 1 } })).toEqual([]);
  });
  it('never records the values of sensitive fields', () => {
    expect(diffFields({ passwordHash: 'a' }, { passwordHash: 'b' })).toEqual([
      { field: 'passwordHash', old: '[redacted]', new: '[redacted]' },
    ]);
  });
});
