/**
 * Contact / account merge (spec 12.4): the survivor keeps, per field, the value from the
 * record the user picked; emails and phones are combined unless a single record is chosen.
 */
export interface MergeCandidate {
  id: string;
  name: string;
  emails: string[];
  phones: string[];
  accountId?: string | null;
  customFields: Record<string, unknown>;
}

/** field → id of the record whose value wins; 'all' (emails/phones) combines them. */
export type MergeChoices = Record<string, string | 'all'>;

export function mergeValues(survivorId: string, all: MergeCandidate[], choices: MergeChoices) {
  const survivor = all.find((c) => c.id === survivorId);
  if (!survivor) throw new Error('The survivor must be one of the records being merged.');
  const pick = (field: string) => all.find((c) => c.id === choices[field]) ?? survivor;
  const combine = (field: 'emails' | 'phones') =>
    choices[field] && choices[field] !== 'all' ? [...pick(field)[field]] : [...new Set(all.flatMap((c) => c[field]))];
  const customKeys = new Set(all.flatMap((c) => Object.keys(c.customFields)));
  const customFields: Record<string, unknown> = {};
  for (const k of customKeys) {
    const chosen = choices[`custom.${k}`];
    const src = chosen
      ? pick(`custom.${k}`)
      : (all.find((c) => c.id === survivorId && c.customFields[k] !== undefined) ??
        all.find((c) => c.customFields[k] !== undefined && c.customFields[k] !== null && c.customFields[k] !== ''));
    if (src && src.customFields[k] !== undefined) customFields[k] = src.customFields[k];
  }
  return {
    name: pick('name').name,
    emails: combine('emails'),
    phones: combine('phones'),
    accountId: pick('accountId').accountId ?? null,
    customFields,
  };
}

export function validateMerge(survivorId: string, ids: string[]): string[] {
  const unique = [...new Set(ids)];
  if (unique.length < 2) return ['Choose at least two records to merge.'];
  if (!unique.includes(survivorId)) return ['Choose which record to keep.'];
  return [];
}
