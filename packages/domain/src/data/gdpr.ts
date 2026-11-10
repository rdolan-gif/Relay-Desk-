import type { FieldChange } from '../audit/audit-events.js';

/**
 * Anonymising (spec 14, GDPR): personal data is replaced with placeholders, irreversibly;
 * metadata (dates, states, categories, SLA outcomes) is kept for reports.
 */
export const REMOVED = '[removed]';
export const REMOVED_HTML = '<p>[removed]</p>';
export const ANONYMOUS_ADDRESS = 'anonymised@invalid';

/** Fields whose history values are metadata, safe to keep after anonymising. */
const METADATA_FIELDS = new Set([
  'categoryId',
  'state',
  'priority',
  'userId',
  'statusIds',
  'parentId',
  'deadline',
  'reopenAt',
  'followerIds',
  'mergedIntoId',
  'mergedTicketIds',
  'unmergedTicketId',
  'noReplyNeeded',
  'databaseId',
  'accountId',
]);

/** History with personal values replaced (titles, bodies, comments, custom values…). */
export function redactChanges(changes: FieldChange[]): FieldChange[] {
  return changes.map((c) =>
    METADATA_FIELDS.has(c.field)
      ? c
      : {
          ...c,
          old: c.old === null || c.old === undefined ? c.old : REMOVED,
          new: c.new === null || c.new === undefined ? c.new : REMOVED,
        },
  );
}

/** The confirmation a user must type before anonymising (spec 14). */
export const anonymiseConfirmation = (ticketId: number) => `ANONYMISE ${ticketId}`;
export const eraseConfirmation = () => 'ERASE';

/** Days since archiving after which a retention policy applies (spec 14 [SHOULD]). */
export function retentionDue(archivedAt: Date | null, days: number | null, now: Date): boolean {
  if (!archivedAt || days === null || days < 1) return false;
  return now.getTime() - archivedAt.getTime() >= days * 86_400_000;
}

/** Soft-deleted items can be restored for this many days (spec 14). */
export const RESTORE_DAYS = 30;
export const canRestore = (deletedAt: Date | null, now: Date) =>
  !!deletedAt && now.getTime() - deletedAt.getTime() <= RESTORE_DAYS * 86_400_000;
