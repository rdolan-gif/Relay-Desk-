import { describe, expect, it } from 'vitest';
import { accountPath, checkBranchParent, normaliseAddress } from './accounts.js';

const addr = { label: '', line1: ' 12 Mill Lane ', town: 'Leeds', postcode: 'ls14ap', country: 'gb', isDelivery: true };

describe('addresses (owner Q2)', () => {
  it('UK postcodes are upper-cased and spaced; empty labels get a default', () => {
    expect(normaliseAddress(addr)).toEqual({
      ok: true,
      address: {
        label: 'Delivery',
        line1: '12 Mill Lane',
        town: 'Leeds',
        postcode: 'LS1 4AP',
        country: 'GB',
        isDelivery: true,
      },
    });
  });
  it('an invalid UK postcode is refused', () => {
    expect(normaliseAddress({ ...addr, postcode: '12345' })).toMatchObject({ ok: false });
  });
  it('non-UK postcodes are kept as typed', () => {
    expect(normaliseAddress({ ...addr, country: 'IE', postcode: 'd02 x285' })).toMatchObject({
      ok: true,
      address: { postcode: 'D02 X285' },
    });
  });
  it('an address needs a first line and a town', () => {
    expect(normaliseAddress({ ...addr, line1: ' ' })).toMatchObject({ ok: false });
  });
});

describe('company › branch (owner Q2)', () => {
  const company = { id: 'co', databaseId: 'db', parentId: null };
  it('a branch can belong to a company in the same database', () => {
    expect(checkBranchParent({ accountId: 'br', databaseId: 'db', parent: company, hasBranches: false })).toEqual({
      ok: true,
    });
  });
  it('branches cannot have branches, and companies with branches cannot become branches', () => {
    expect(
      checkBranchParent({
        accountId: 'x',
        databaseId: 'db',
        parent: { ...company, parentId: 'top' },
        hasBranches: false,
      }).ok,
    ).toBe(false);
    expect(checkBranchParent({ accountId: 'x', databaseId: 'db', parent: company, hasBranches: true }).ok).toBe(false);
  });
  it('a branch must be in the same database and cannot be its own parent', () => {
    expect(checkBranchParent({ accountId: 'x', databaseId: 'other', parent: company, hasBranches: false }).ok).toBe(
      false,
    );
    expect(checkBranchParent({ accountId: 'co', databaseId: 'db', parent: company, hasBranches: false }).ok).toBe(
      false,
    );
  });
  it('the display path reads Company › Branch › Branch number', () => {
    expect(accountPath('Northgate Electrical', 'Leeds', '0345')).toBe('Northgate Electrical › Leeds › 0345');
    expect(accountPath(null, 'Acme Ltd', null)).toBe('Acme Ltd');
  });
});
