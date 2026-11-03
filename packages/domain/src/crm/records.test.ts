import { describe, expect, it } from 'vitest';
import { canLinkContactToAccount, isValidRecordStatus, validateRecordStatuses } from './records.js';

const statuses = [
  { key: 'new', title: 'New' },
  { key: 'won', title: 'Won' },
];

describe('CRM records (spec 12.2)', () => {
  it("when a record is saved, its status must be one of its type's statuses", () => {
    expect(isValidRecordStatus(statuses, 'won')).toBe(true);
    expect(isValidRecordStatus(statuses, 'lost')).toBe(false);
    expect(isValidRecordStatus(statuses, null)).toBe(true);
  });
  it('record type statuses need unique keys and titles', () => {
    expect(validateRecordStatuses(statuses)).toEqual([]);
    expect(validateRecordStatuses([...statuses, { key: 'new', title: '' }]).length).toBe(2);
  });
  it('a contact can only be linked to an account in the same CRM database', () => {
    expect(canLinkContactToAccount('db1', 'db1')).toBe(true);
    expect(canLinkContactToAccount('db1', 'db2')).toBe(false);
  });
});
