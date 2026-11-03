import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { stateAt, unflattenFromHistory, type FieldChange, type HistoryRecord } from '@relay-desk/domain';
import type { AuthContext } from '../common/request-context';
import { DB, type Db, type DbOrTx } from '../db/db';
import { historyEntries, users } from '../db/schema';

export type HistoryEntityType = 'contact' | 'account' | 'crm_record';

/**
 * Entity history (spec 17). Entries are written in the caller's transaction and are
 * never edited. Field names are flat; custom values appear as `custom.<fieldId>`.
 */
@Injectable()
export class HistoryService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async record(
    tx: DbOrTx,
    auth: AuthContext,
    entityType: HistoryEntityType,
    entityId: string,
    action: HistoryRecord['action'],
    changes: FieldChange[],
  ): Promise<void> {
    if (action === 'update' && changes.length === 0) return;
    await tx.insert(historyEntries).values({
      entityType,
      entityId,
      action,
      userId: auth.user.id,
      sessionId: auth.sessionId,
      changes,
    });
  }

  async list(entityType: HistoryEntityType, entityId: string) {
    return this.db
      .select({
        id: historyEntries.id,
        action: historyEntries.action,
        changes: historyEntries.changes,
        createdAt: historyEntries.createdAt,
        userId: historyEntries.userId,
        userName: users.name,
        sessionId: historyEntries.sessionId,
      })
      .from(historyEntries)
      .leftJoin(users, eq(users.id, historyEntries.userId))
      .where(and(eq(historyEntries.entityType, entityType), eq(historyEntries.entityId, entityId)))
      .orderBy(asc(historyEntries.createdAt), asc(historyEntries.id));
  }

  /** The entity's flat state at a past moment, or null if it did not exist then. */
  async snapshot(entityType: HistoryEntityType, entityId: string, currentFlat: Record<string, unknown>, at: Date) {
    const entries = await this.list(entityType, entityId);
    const flat = stateAt(
      currentFlat,
      entries.map((e) => ({ action: e.action as HistoryRecord['action'], changes: e.changes, createdAt: e.createdAt })),
      at,
    );
    return flat ? unflattenFromHistory(flat) : null;
  }
}
