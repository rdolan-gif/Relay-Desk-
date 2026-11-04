import { describe, expect, it } from 'vitest';
import {
  anonymiseConfirmation,
  canRestore,
  guessMapping,
  importAction,
  mapRow,
  mergeValues,
  parseCsv,
  redactChanges,
  retentionDue,
  toCsv,
  validateMapping,
  validateMerge,
} from './index.js';

describe('CSV (spec 12.4)', () => {
  it('reads quoted fields, doubled quotes, embedded newlines, CRLF and a BOM', () => {
    const text = '﻿Name,Email\r\n"Smith, Jo","jo@example.com"\r\n"Say ""hi""","a@b.com\nc@d.com"\n';
    expect(parseCsv(text)).toEqual([
      ['Name', 'Email'],
      ['Smith, Jo', 'jo@example.com'],
      ['Say "hi"', 'a@b.com\nc@d.com'],
    ]);
  });

  it('guesses semicolon-separated files (common from UK Excel) and skips blank lines', () => {
    expect(parseCsv('Name;Phone\n\nJo;07911 123456\n')).toEqual([
      ['Name', 'Phone'],
      ['Jo', '07911 123456'],
    ]);
  });

  it('written cells are quoted when needed and formulas are neutralised', () => {
    const out = toCsv([
      ['Name', 'Note'],
      ['=HYPERLINK("x")', 'a, b'],
      ['+44 7911', ['x@y.com', 'z@y.com']],
    ]);
    expect(out).toBe('﻿Name,Note\r\n"\'=HYPERLINK(""x"")","a, b"\r\n\'+44 7911,"x@y.com; z@y.com"\r\n');
  });
});

describe('import mapping (spec 12.4)', () => {
  it('guesses a mapping from header names, including custom fields', () => {
    expect(
      guessMapping(
        'contacts',
        ['Full name', 'E-mail', 'Telephone', 'Company', 'Customer type', 'Notes'],
        [{ key: 'customer_type', name: 'Customer type' }],
      ),
    ).toEqual({
      'Full name': 'name',
      'E-mail': 'emails',
      Telephone: 'phones',
      Company: 'account',
      'Customer type': 'custom:customer_type',
      Notes: '',
    });
    expect(guessMapping('accounts', ['Company', 'Branch number'], [])).toEqual({
      Company: 'company',
      'Branch number': 'branchCode',
    });
  });

  it('maps a row, splitting several emails or phones in one cell and joining split names', () => {
    const r = mapRow(
      ['First', 'Last', 'Email', 'Tier'],
      ['Jo', 'Smith', 'jo@a.com; jo@b.com', 'Gold'],
      { First: 'name', Last: 'name', Email: 'emails', Tier: 'custom:tier' },
      2,
    );
    expect(r).toMatchObject({ line: 2, name: 'Jo Smith', emails: ['jo@a.com', 'jo@b.com'], custom: { tier: 'Gold' } });
  });

  it('a mapping needs a Name column and no field mapped twice', () => {
    expect(validateMapping('contacts', { A: 'emails' })).toEqual(['Map a column to Name.']);
    expect(validateMapping('contacts', { A: 'name', B: 'account', C: 'account' })[0]).toMatch(/more than one/i);
    expect(validateMapping('contacts', { A: 'name', B: 'branchCode' })[0]).toMatch(/not a field/);
  });

  it('duplicates are skipped, updated or created as chosen', () => {
    expect(importAction(0, 'skip')).toBe('create');
    expect(importAction(1, 'skip')).toBe('skip');
    expect(importAction(1, 'update')).toBe('update');
    expect(importAction(2, 'create')).toBe('create');
  });
});

describe('merging contacts (spec 12.4)', () => {
  const a = {
    id: 'a',
    name: 'Jo Smith',
    emails: ['jo@a.com'],
    phones: ['+447911123456'],
    accountId: 'acc1',
    customFields: { tier: 'gold' },
  };
  const b = {
    id: 'b',
    name: 'Joanne Smith',
    emails: ['jo@b.com', 'jo@a.com'],
    phones: [],
    accountId: null,
    customFields: { tier: 'silver', notes: 'VIP' },
  };

  it('the survivor takes each chosen field; emails and phones are combined unless one record is picked', () => {
    expect(mergeValues('a', [a, b], { name: 'b' })).toEqual({
      name: 'Joanne Smith',
      emails: ['jo@a.com', 'jo@b.com'],
      phones: ['+447911123456'],
      accountId: 'acc1',
      customFields: { tier: 'gold', notes: 'VIP' },
    });
    expect(mergeValues('a', [a, b], { emails: 'b', 'custom.tier': 'b' })).toMatchObject({
      emails: ['jo@b.com', 'jo@a.com'],
      customFields: { tier: 'silver' },
    });
  });

  it('a merge needs two records and a survivor among them', () => {
    expect(validateMerge('a', ['a'])).toHaveLength(1);
    expect(validateMerge('c', ['a', 'b'])).toHaveLength(1);
    expect(validateMerge('a', ['a', 'b'])).toEqual([]);
  });
});

describe('GDPR (spec 14)', () => {
  it('history keeps metadata but replaces personal values', () => {
    expect(
      redactChanges([
        { field: 'title', old: 'Jo Smith refund', new: 'Refund' },
        { field: 'state', old: 'open', new: 'closed' },
        { field: 'custom.f1', old: null, new: '12 High St' },
        { field: 'comment:x', old: '<p>call 07911</p>', new: '<p>…</p>' },
      ]),
    ).toEqual([
      { field: 'title', old: '[removed]', new: '[removed]' },
      { field: 'state', old: 'open', new: 'closed' },
      { field: 'custom.f1', old: null, new: '[removed]' },
      { field: 'comment:x', old: '[removed]', new: '[removed]' },
    ]);
  });

  it('anonymising needs the typed confirmation', () => {
    expect(anonymiseConfirmation(42)).toBe('ANONYMISE 42');
  });

  it('retention applies N days after archiving; deleted items can be restored for 30 days', () => {
    const now = new Date('2026-11-04T12:00:00Z');
    expect(retentionDue(new Date('2026-10-04T12:00:00Z'), 30, now)).toBe(true);
    expect(retentionDue(new Date('2026-10-06T12:00:00Z'), 30, now)).toBe(false);
    expect(retentionDue(null, 30, now)).toBe(false);
    expect(retentionDue(new Date('2020-01-01'), null, now)).toBe(false);
    expect(canRestore(new Date('2026-10-06T12:00:00Z'), now)).toBe(true);
    expect(canRestore(new Date('2026-10-04T11:00:00Z'), now)).toBe(false);
  });
});
