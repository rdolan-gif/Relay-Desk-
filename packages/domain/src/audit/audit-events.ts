/** System audit log event types (spec 17, "System audit log"). */
export const AUDIT_EVENT_TYPES = [
  'auth.login_succeeded',
  'auth.login_failed',
  'auth.logout',
  'auth.password_changed',
  'auth.totp_enabled',
  'auth.totp_disabled',
  'auth.api_token_created',
  'auth.api_token_revoked',
  'user.created',
  'user.updated',
  'user.deactivated',
  'user.reactivated',
  'access_profile.created',
  'access_profile.updated',
  'access_profile.deleted',
  'rights_profile.created',
  'rights_profile.updated',
  'rights_profile.deleted',
  'settings.created',
  'settings.updated',
  'settings.deleted',
  'export.run',
  'bulk_job.run',
  'gdpr.anonymised',
  'gdpr.erased',
  'gdpr.subject_access_export',
  'import.run',
  'merge.run',
  'delete.run',
  'delete.restored',
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/** Audit entries are kept for two years. */
export const AUDIT_RETENTION_DAYS = 730;

export interface FieldChange {
  field: string;
  old: unknown;
  new: unknown;
}

const REDACTED = '[redacted]';
const SENSITIVE_FIELDS = new Set(['password', 'passwordHash', 'totpSecret', 'apiTokenHash']);

/**
 * Field-level diff between two flat-ish objects, used for audit and history entries.
 * Nested values are compared structurally. Sensitive fields are reported as changed
 * but never with their values.
 */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): FieldChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: FieldChange[] = [];
  for (const field of [...keys].sort()) {
    const a = before[field];
    const b = after[field];
    if (stableStringify(a) === stableStringify(b)) continue;
    if (SENSITIVE_FIELDS.has(field)) {
      changes.push({ field, old: REDACTED, new: REDACTED });
    } else {
      changes.push({ field, old: a ?? null, new: b ?? null });
    }
  }
  return changes;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}
