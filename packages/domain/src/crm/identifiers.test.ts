import { describe, expect, it } from 'vitest';
import {
  formatPhoneForDisplay,
  isMatchable,
  normaliseContactIdentifiers,
  normaliseEmailAddress,
  normalisePhone,
} from './identifiers.js';

describe('contact identifier normalisation (spec 12.3)', () => {
  it('when an email is saved, the system lower-cases and trims it', () => {
    expect(normaliseEmailAddress('  Jane.Doe@Example.CO.UK ')).toEqual({ ok: true, value: 'jane.doe@example.co.uk' });
  });
  it('when an email is malformed, the system rejects it', () => {
    expect(normaliseEmailAddress('jane@')).toMatchObject({ ok: false });
    expect(normaliseEmailAddress('no at sign')).toMatchObject({ ok: false });
  });
  it('when an address carries a pasted separator or a bad domain, the system rejects it', () => {
    for (const bad of ['buyer@example.com,', 'a@b.com;', 'Name <a@b.com>', 'a@-b.com', 'a@b.c', 'a@b..com']) {
      expect(normaliseEmailAddress(bad).ok, bad).toBe(false);
    }
    for (const good of ['first.last+tag@ricoman.com', "o'brien@sub.example.co.uk", 'x@xn--bcher-kva.example']) {
      expect(normaliseEmailAddress(good).ok, good).toBe(true);
    }
  });
  it('when a UK number is saved without a country code, the system stores it in E.164 with +44', () => {
    expect(normalisePhone('020 7946 0958')).toEqual({ ok: true, value: '+442079460958' });
    expect(normalisePhone('07911 123456')).toEqual({ ok: true, value: '+447911123456' });
  });
  it('when a number has an international prefix, the system keeps its country', () => {
    expect(normalisePhone('+1 (212) 555-0123')).toEqual({ ok: true, value: '+12125550123' });
    expect(normalisePhone('0033 1 42 68 53 00')).toEqual({ ok: true, value: '+33142685300' });
    expect(normalisePhone('+44 (0)20 7946 0958')).toEqual({ ok: true, value: '+442079460958' });
  });
  it('when a phone number is invalid, the system rejects it', () => {
    expect(normalisePhone('12345')).toMatchObject({ ok: false });
    expect(normalisePhone('not a number')).toMatchObject({ ok: false });
  });
  it('a contact with two emails and a UK phone is normalised, with duplicates removed', () => {
    expect(
      normaliseContactIdentifiers({
        emails: ['Sam@Example.com', ' sam.work@EXAMPLE.com', 'sam@example.com'],
        phones: ['07911 123456', '+447911123456'],
      }),
    ).toEqual({ ok: true, emails: ['sam@example.com', 'sam.work@example.com'], phones: ['+447911123456'] });
  });
  it('reports which entries are invalid', () => {
    const r = normaliseContactIdentifiers({ emails: ['ok@example.com', 'bad'], phones: ['999'] });
    expect(r).toMatchObject({ ok: false, errors: { emails: [{ index: 1 }], phones: [{ index: 0 }] } });
  });
  it('a contact with neither email nor phone cannot be matched', () => {
    expect(isMatchable({ emails: [], phones: [] })).toBe(false);
    expect(isMatchable({ emails: ['a@b.co'], phones: [] })).toBe(true);
  });
});

describe('phone display (Q-P1-8)', () => {
  it('UK numbers are shown in UK national format', () => {
    expect(formatPhoneForDisplay('+447911123456')).toBe('07911 123456');
    expect(formatPhoneForDisplay('+442079460958')).toBe('020 7946 0958');
  });
  it('other countries are shown in international format', () => {
    expect(formatPhoneForDisplay('+33142685300')).toBe('+33 1 42 68 53 00');
  });
  it('unparseable values are shown as stored', () => {
    expect(formatPhoneForDisplay('garbage')).toBe('garbage');
  });
});
