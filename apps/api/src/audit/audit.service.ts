import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, lte, type SQL } from 'drizzle-orm';
import type { AuditEventType, FieldChange } from '@relay-desk/domain';
import { AUDIT_RETENTION_DAYS } from '@relay-desk/domain';
import { DB, type Db, type DbOrTx } from '../db/db';
import { auditLog } from '../db/schema';

export interface AuditEntryInput {
  eventType: AuditEventType;
  actorUserId?: string | null;
  actorLabel?: string | null;
  ip?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  changes?: FieldChange[];
  details?: Record<string, unknown>;
}

export interface AuditQuery {
  eventType?: string;
  actorUserId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  beforeId?: number;
}

/**
 * System audit log (spec 17). Append-only: there is no update or delete path except
 * the retention purge. Pass the transaction handle so the entry commits with the change.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async record(entry: AuditEntryInput, tx: DbOrTx = this.db): Promise<void> {
    await tx.insert(auditLog).values({
      eventType: entry.eventType,
      actorUserId: entry.actorUserId ?? null,
      actorLabel: entry.actorLabel ?? null,
      ip: entry.ip ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      details: { ...(entry.details ?? {}), ...(entry.changes ? { changes: entry.changes } : {}) },
    });
  }

  async list(q: AuditQuery) {
    const where: SQL[] = [];
    if (q.eventType) where.push(eq(auditLog.eventType, q.eventType));
    if (q.actorUserId) where.push(eq(auditLog.actorUserId, q.actorUserId));
    if (q.from) where.push(gte(auditLog.createdAt, q.from));
    if (q.to) where.push(lte(auditLog.createdAt, q.to));
    if (q.beforeId) where.push(lt(auditLog.id, q.beforeId));
    return this.db
      .select()
      .from(auditLog)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(auditLog.id))
      .limit(q.limit);
  }

  /** Deletes entries older than the retention period. Intended for a scheduled job. */
  async purgeExpired(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * 24 * 3600 * 1000);
    const deleted = await this.db.delete(auditLog).where(lt(auditLog.createdAt, cutoff)).returning({ id: auditLog.id });
    return deleted.length;
  }
}
