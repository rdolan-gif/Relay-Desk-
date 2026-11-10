/**
 * Contact and account import (spec 12.4): map columns to fields, split multi-value cells,
 * and decide per row whether to create, update or skip.
 */
export type ImportEntity = 'contacts' | 'accounts';
export type DuplicateMode = 'skip' | 'update' | 'create';
export type MatchOn = 'email' | 'phone';

/** Target fields; custom fields are "custom:<key>". */
export const IMPORT_FIELDS: Record<ImportEntity, string[]> = {
  contacts: ['name', 'emails', 'phones', 'account'],
  accounts: ['name', 'emails', 'phones', 'company', 'branchCode'],
};

/** column header → target field ('' = ignore). */
export type ImportMapping = Record<string, string>;

export interface MappedRow {
  line: number;
  name: string;
  emails: string[];
  phones: string[];
  /** Account name (contacts) or company name (branch accounts). */
  parent: string | null;
  branchCode: string | null;
  custom: Record<string, string>;
}

export const splitMulti = (v: string | undefined) =>
  (v ?? '')
    .split(/[;,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Guesses a mapping from the header names ("E-mail" → emails, "Telephone" → phones…). */
export function guessMapping(
  entity: ImportEntity,
  headers: string[],
  customKeys: { key: string; name: string }[],
): ImportMapping {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const known: Record<string, string> = {
    name: 'name',
    fullname: 'name',
    contact: 'name',
    contactname: 'name',
    company: entity === 'contacts' ? 'account' : 'company',
    companyname: entity === 'contacts' ? 'account' : 'company',
    account: entity === 'contacts' ? 'account' : 'name',
    accountname: entity === 'contacts' ? 'account' : 'name',
    email: 'emails',
    emails: 'emails',
    emailaddress: 'emails',
    phone: 'phones',
    phones: 'phones',
    telephone: 'phones',
    tel: 'phones',
    mobile: 'phones',
    branch: 'branchCode',
    branchcode: 'branchCode',
    branchnumber: 'branchCode',
  };
  const out: ImportMapping = {};
  for (const h of headers) {
    const n = norm(h);
    const custom = customKeys.find((c) => norm(c.key) === n || norm(c.name) === n);
    const target = custom ? `custom:${custom.key}` : (known[n] ?? '');
    out[h] = target && (target.startsWith('custom:') || IMPORT_FIELDS[entity].includes(target)) ? target : '';
  }
  return out;
}

export function mapRow(headers: string[], cells: string[], mapping: ImportMapping, line: number): MappedRow {
  const r: MappedRow = { line, name: '', emails: [], phones: [], parent: null, branchCode: null, custom: {} };
  headers.forEach((h, i) => {
    const target = mapping[h];
    const v = (cells[i] ?? '').trim();
    if (!target || !v) return;
    if (target === 'name') r.name = r.name ? `${r.name} ${v}` : v;
    else if (target === 'emails') r.emails.push(...splitMulti(v));
    else if (target === 'phones') r.phones.push(...splitMulti(v));
    else if (target === 'account' || target === 'company') r.parent = v;
    else if (target === 'branchCode') r.branchCode = v;
    else if (target.startsWith('custom:')) r.custom[target.slice(7)] = v;
  });
  return r;
}

export function validateMapping(entity: ImportEntity, mapping: ImportMapping): string[] {
  const targets = Object.values(mapping).filter(Boolean);
  const errors: string[] = [];
  if (!targets.includes('name')) errors.push('Map a column to Name.');
  const dupes = targets.filter((t, i) => t !== 'name' && t !== 'emails' && t !== 'phones' && targets.indexOf(t) !== i);
  if (dupes.length) errors.push(`More than one column is mapped to ${[...new Set(dupes)].join(', ')}.`);
  for (const t of targets)
    if (!t.startsWith('custom:') && !IMPORT_FIELDS[entity].includes(t))
      errors.push(`"${t}" is not a field you can import.`);
  return errors;
}

/** What to do with a row given how many existing records match it. */
export function importAction(matches: number, mode: DuplicateMode): 'create' | 'update' | 'skip' {
  if (!matches || mode === 'create') return 'create';
  return mode === 'update' ? 'update' : 'skip';
}
