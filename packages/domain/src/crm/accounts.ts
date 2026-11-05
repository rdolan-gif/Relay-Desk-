/** A postal address on an account or branch (owner answer Q2). */
export interface Address {
  label: string;
  line1: string;
  line2?: string;
  town: string;
  county?: string;
  postcode: string;
  country: string;
  /** Delivery addresses are shown on the branch's contact card. */
  isDelivery: boolean;
}

const UK_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?) ?(\d[A-Z]{2})$/;

export type AddressCheck = { ok: true; address: Address } | { ok: false; error: string };

/** Trims fields; UK postcodes are upper-cased, spaced ("LS1 4AP") and checked for shape. */
export function normaliseAddress(a: Address): AddressCheck {
  const t = (s: string | undefined) => (s ?? '').trim();
  const country = (t(a.country) || 'GB').toUpperCase();
  let postcode = t(a.postcode).toUpperCase().replace(/\s+/g, ' ');
  if (!t(a.line1) || !t(a.town)) return { ok: false, error: 'An address needs a first line and a town.' };
  if (country === 'GB') {
    const m = postcode.replace(/ /g, '').match(UK_POSTCODE);
    if (!m) return { ok: false, error: `"${a.postcode}" is not a valid UK postcode.` };
    postcode = `${m[1]} ${m[2]}`;
  }
  return {
    ok: true,
    address: {
      label: t(a.label) || (a.isDelivery ? 'Delivery' : 'Address'),
      line1: t(a.line1),
      ...(t(a.line2) ? { line2: t(a.line2) } : {}),
      town: t(a.town),
      ...(t(a.county) ? { county: t(a.county) } : {}),
      postcode,
      country,
      isDelivery: !!a.isDelivery,
    },
  };
}

/**
 * Customers with branches are Company › Branch (owner answer Q2). A branch's parent must
 * be a company in the same CRM database that is not itself a branch, and a company with
 * branches cannot become a branch.
 */
export function checkBranchParent(args: {
  accountId: string | null;
  databaseId: string;
  parent: { id: string; databaseId: string; parentId: string | null } | null;
  hasBranches: boolean;
}): { ok: true } | { ok: false; error: string } {
  const { parent } = args;
  if (!parent) return { ok: true };
  if (parent.id === args.accountId) return { ok: false, error: 'An account cannot be its own branch.' };
  if (parent.databaseId !== args.databaseId)
    return { ok: false, error: 'A branch must be in the same CRM database as its company.' };
  if (parent.parentId) return { ok: false, error: 'Branches cannot have branches of their own.' };
  if (args.hasBranches) return { ok: false, error: 'This account has branches, so it cannot become a branch.' };
  return { ok: true };
}

/** Display path, e.g. "Northgate Electrical › Leeds › 0345". */
export function accountPath(parentName: string | null, name: string, branchCode: string | null): string {
  return [parentName, name, branchCode].filter((p): p is string => !!p && p.trim() !== '').join(' › ');
}
