import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, isNotNull, isNull } from 'drizzle-orm';
import { canRestore, RESTORE_DAYS } from '@relay-desk/domain';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/request-context';
import { AccountsService } from '../crm/accounts.service';
import { ContactsService } from '../crm/contacts.service';
import { DB, type Db } from '../db/db';
import { accounts, contacts, tickets } from '../db/schema';
import { HistoryService } from '../history/history.service';
import { JobsService } from '../jobs/jobs.service';
import { TicketsService, type TicketInput } from '../tickets/tickets.service';

export type DeletedType = 'tickets' | 'contacts' | 'accounts';
const JOB_THRESHOLD = 200;

/**
 * Bulk delete (soft, recoverable by an administrator for 30 days) and bulk edit as a
 * background job above 200 items (spec 14).
 */
@Injectable()
export class BulkService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TicketsService) private readonly tickets: TicketsService,
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(HistoryService) private readonly history: HistoryService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(JobsService) private readonly jobs: JobsService,
  ) {}

  private async each<T>(ids: T[], fn: (id: T) => Promise<unknown>, progress?: (n: number) => Promise<void>) {
    const done: T[] = [];
    const failed: { id: T; message: string }[] = [];
    let n = 0;
    for (const id of ids) {
      try {
        await fn(id);
        done.push(id);
      } catch (err) {
        failed.push({ id, message: (err as { response?: { message?: string } }).response?.message ?? (err as Error).message });
      }
      if (progress) await progress(++n);
    }
    return { done, failed };
  }

  /** Up to 200 at once; more runs as a job with progress. */
  private async runMaybeAsJob<T>(auth: AuthContext, kind: string, title: string, ids: T[], fn: (id: T) => Promise<unknown>) {
    if (ids.length <= JOB_THRESHOLD) return this.each(ids, fn);
    const job = await this.jobs.start(auth, kind, title, { count: ids.length }, async (ctx) => {
      await ctx.progress(0, ids.length);
      const r = await this.each(ids, fn, (n) => ctx.progress(n));
      return { done: r.done.length, failed: r.failed.length };
    });
    return { job };
  }

  async bulkEditTickets(auth: AuthContext, ids: number[], changes: Omit<TicketInput, 'version' | 'customFields' | 'followerIds'>) {
    const r = await this.runMaybeAsJob(auth, 'bulk_edit', `Bulk edit of ${ids.length} tickets`, ids, (id) => this.tickets.update(auth, id, changes, 'bulk'));
    return 'job' in r ? r : { updated: r.done, failed: r.failed };
  }

  async bulkDelete(auth: AuthContext, type: DeletedType, ids: (string | number)[], ip: string | null) {
    const fn =
      type === 'tickets'
        ? (id: string | number) => this.tickets.remove(auth, Number(id))
        : type === 'contacts'
          ? (id: string | number) => this.contacts.remove(auth, String(id))
          : (id: string | number) => this.accounts.remove(auth, String(id));
    await this.audit.record({ eventType: 'delete.run', actorUserId: auth.user.id, ip, targetType: type, details: { count: ids.length } });
    const r = await this.runMaybeAsJob(auth, `bulk_delete_${type}`, `Delete ${ids.length} ${type}`, ids, fn);
    return 'job' in r ? r : { deleted: r.done, failed: r.failed };
  }

  // ------------------------------------------------------------------ recovery

  private admin(auth: AuthContext) {
    if (auth.user.type !== 'administrator')
      throw new ForbiddenException({ message: 'Only administrators can restore deleted items.', reason: 'admin_only' });
  }

  /** Deleted in the last 30 days and restorable (not merged away, not erased). */
  async listDeleted(auth: AuthContext, type: DeletedType) {
    this.admin(auth);
    const since = new Date(Date.now() - RESTORE_DAYS * 86_400_000);
    if (type === 'tickets')
      return (
        await this.db
          .select({ id: tickets.id, title: tickets.title, deletedAt: tickets.deletedAt })
          .from(tickets)
          .where(and(isNotNull(tickets.deletedAt), gte(tickets.deletedAt, since), eq(tickets.isAnonymised, false)))
          .orderBy(desc(tickets.deletedAt))
          .limit(500)
      ).map((r) => ({ id: String(r.id), title: `#${r.id} ${r.title}`, deletedAt: r.deletedAt }));
    const table = type === 'contacts' ? contacts : accounts;
    const extra = type === 'contacts' ? isNull(contacts.anonymisedAt) : undefined;
    return this.db
      .select({ id: table.id, title: table.name, deletedAt: table.deletedAt })
      .from(table)
      .where(and(isNotNull(table.deletedAt), gte(table.deletedAt, since), isNull(table.mergedIntoId), extra))
      .orderBy(desc(table.deletedAt))
      .limit(500);
  }

  async restore(auth: AuthContext, type: DeletedType, id: string, ip: string | null) {
    this.admin(auth);
    const now = new Date();
    if (type === 'tickets') {
      const [t] = await this.db.select().from(tickets).where(eq(tickets.id, Number(id)));
      if (!t || !canRestore(t.deletedAt, now) || t.isAnonymised) throw new NotFoundException({ message: 'This ticket can no longer be restored.', reason: 'not_restorable' });
      await this.db.transaction(async (tx) => {
        await tx.update(tickets).set({ deletedAt: null }).where(eq(tickets.id, t.id));
        await this.history.record(tx, auth, 'ticket', t.id, 'update', [{ field: 'deleted', old: true, new: false }]);
        await this.audit.record({ eventType: 'delete.restored', actorUserId: auth.user.id, ip, targetType: 'ticket', targetId: id }, tx);
      });
      return { restored: true };
    }
    const table = type === 'contacts' ? contacts : accounts;
    const [r] = await this.db.select().from(table).where(eq(table.id, id));
    if (!r || !canRestore(r.deletedAt, now) || r.mergedIntoId || ('anonymisedAt' in r && r.anonymisedAt))
      throw new NotFoundException({ message: 'This item can no longer be restored.', reason: 'not_restorable' });
    if (!['contacts', 'accounts'].includes(type)) throw new BadRequestException();
    await this.db.transaction(async (tx) => {
      await tx.update(table).set({ deletedAt: null }).where(eq(table.id, id));
      await this.history.record(tx, auth, type === 'contacts' ? 'contact' : 'account', id, 'update', [{ field: 'deleted', old: true, new: false }]);
      await this.audit.record({ eventType: 'delete.restored', actorUserId: auth.user.id, ip, targetType: type.slice(0, -1), targetId: id }, tx);
    });
    return { restored: true };
  }
}
