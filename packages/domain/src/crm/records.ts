/** CRM record stage (spec 12.2). */
export const RECORD_STAGES = ['open', 'closed'] as const;
export type RecordStage = (typeof RECORD_STAGES)[number];

export interface RecordStatusDef {
  key: string;
  title: string;
}

/** When a record is saved, its status must be one of its record type's statuses (or empty). */
export function isValidRecordStatus(statuses: readonly RecordStatusDef[], status: string | null): boolean {
  return status === null || statuses.some((s) => s.key === status);
}

export function validateRecordStatuses(statuses: readonly RecordStatusDef[]): string[] {
  const errors: string[] = [];
  const keys = statuses.map((s) => s.key);
  if (new Set(keys).size !== keys.length) errors.push('Status keys must be unique.');
  if (statuses.some((s) => !/^[a-z][a-z0-9_]{0,62}$/.test(s.key))) errors.push('Status keys use a-z, 0-9 and _.');
  if (statuses.some((s) => !s.title.trim())) errors.push('Each status needs a title.');
  return errors;
}

/**
 * When a contact is linked to an account, both must be in the same CRM database
 * (docs/open-questions.md, Q-P1-3).
 */
export function canLinkContactToAccount(contactDatabaseId: string, accountDatabaseId: string): boolean {
  return contactDatabaseId === accountDatabaseId;
}
