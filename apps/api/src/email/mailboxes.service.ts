import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { canUseMailbox, diffFields, normaliseMailAddress } from '@relay-desk/domain';
import { AuditService } from '../audit/audit.service';
import { SECRET_BOX, SecretBox } from '../common/crypto';
import { isUniqueViolation } from '../common/db-errors';
import type { AuthContext } from '../common/request-context';
import { DB, type Db } from '../db/db';
import { categories, crmDatabases, mailboxQueueCrmDatabases, mailboxQueues } from '../db/schema';
import type { MailboxRef } from './providers';

export interface MailboxInput {
  title: string;
  address: string;
  senderName: string;
  provider: 'gmail' | 'fake';
  defaultCategoryId: string;
  headerThreading: boolean;
  active: boolean;
  autoResponseEnabled: boolean;
  autoResponseNewOnly: boolean;
  autoResponseTemplateId: string | null;
  defaultBodyTemplateId: string | null;
  crmDatabaseIds: string[];
}

export type MailboxRow = typeof mailboxQueues.$inferSelect;

/** Mailbox queues (spec 11.1). Credentials never leave the server. */
@Injectable()
export class MailboxesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SECRET_BOX) private readonly secrets: SecretBox,
  ) {}

  async list() {
    const rows = await this.db
      .select()
      .from(mailboxQueues)
      .where(isNull(mailboxQueues.deletedAt))
      .orderBy(asc(mailboxQueues.title));
    const links = await this.db.select().from(mailboxQueueCrmDatabases);
    return rows.map((r) =>
      publicMailbox(
        r,
        links.filter((l) => l.queueId === r.id).map((l) => l.crmDatabaseId),
      ),
    );
  }

  /** Mailboxes the caller may send from (spec 4, mailbox rights). */
  async forUser(auth: AuthContext) {
    return (await this.list())
      .filter((m) => canUseMailbox(auth.ticketRights, m.id))
      .map((m) => ({
        id: m.id,
        title: m.title,
        address: m.address,
        senderName: m.senderName,
        defaultCategoryId: m.defaultCategoryId,
      }));
  }

  async get(id: string) {
    const r = await this.find(id);
    const links = await this.db.select().from(mailboxQueueCrmDatabases).where(eq(mailboxQueueCrmDatabases.queueId, id));
    return publicMailbox(
      r,
      links.map((l) => l.crmDatabaseId),
    );
  }

  async create(auth: AuthContext, input: MailboxInput, ip: string | null) {
    await this.check(input);
    try {
      return await this.db.transaction(async (tx) => {
        const { crmDatabaseIds, ...values } = input;
        const [row] = await tx
          .insert(mailboxQueues)
          .values({ ...values, address: normaliseMailAddress(values.address) })
          .returning();
        // New mailboxes are linked to the default CRM database when none is chosen (spec 12.1).
        let dbIds = crmDatabaseIds;
        if (!dbIds.length) {
          const [def] = await tx
            .select()
            .from(crmDatabases)
            .where(and(eq(crmDatabases.isDefault, true), isNull(crmDatabases.deletedAt)));
          dbIds = def ? [def.id] : [];
        }
        if (dbIds.length)
          await tx
            .insert(mailboxQueueCrmDatabases)
            .values(dbIds.map((crmDatabaseId) => ({ queueId: row!.id, crmDatabaseId })));
        await this.audit.record(
          {
            eventType: 'settings.created',
            actorUserId: auth.user.id,
            ip,
            targetType: 'mailbox',
            targetId: row!.id,
            details: { address: row!.address },
          },
          tx,
        );
        return publicMailbox(row!, dbIds);
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new BadRequestException({ message: 'That address already has a mailbox.', reason: 'duplicate_address' });
      throw err;
    }
  }

  async update(auth: AuthContext, id: string, input: MailboxInput, ip: string | null) {
    const before = await this.get(id);
    await this.check(input);
    const address = normaliseMailAddress(input.address);
    return this.db.transaction(async (tx) => {
      const { crmDatabaseIds, ...values } = input;
      const addressChanged = address !== before.address;
      const [row] = await tx
        .update(mailboxQueues)
        .set({
          ...values,
          address,
          // A different address needs a fresh Google connection.
          ...(addressChanged ? { credentialsEnc: null, connectedAs: null, syncCursor: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(mailboxQueues.id, id))
        .returning();
      await tx.delete(mailboxQueueCrmDatabases).where(eq(mailboxQueueCrmDatabases.queueId, id));
      if (crmDatabaseIds.length)
        await tx
          .insert(mailboxQueueCrmDatabases)
          .values(crmDatabaseIds.map((crmDatabaseId) => ({ queueId: id, crmDatabaseId })));
      const after = publicMailbox(row!, crmDatabaseIds);
      await this.audit.record(
        {
          eventType: 'settings.updated',
          actorUserId: auth.user.id,
          ip,
          targetType: 'mailbox',
          targetId: id,
          changes: diffFields(before as never, after as never),
        },
        tx,
      );
      return after;
    });
  }

  async remove(auth: AuthContext, id: string, ip: string | null) {
    await this.find(id);
    await this.db.transaction(async (tx) => {
      await tx
        .update(mailboxQueues)
        .set({ deletedAt: new Date(), credentialsEnc: null, active: false })
        .where(eq(mailboxQueues.id, id));
      await this.audit.record(
        { eventType: 'settings.deleted', actorUserId: auth.user.id, ip, targetType: 'mailbox', targetId: id },
        tx,
      );
    });
  }

  /** Stores the Google refresh token (encrypted) after sign-in. The Gmail address must match the mailbox. */
  async connect(queueId: string, userId: string, email: string, refreshToken: string) {
    const box = await this.find(queueId);
    if (normaliseMailAddress(email) !== box.address) {
      throw new ForbiddenException({
        message: `You signed in as ${email}, but this mailbox is ${box.address}. Sign in with that account.`,
        reason: 'wrong_account',
      });
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(mailboxQueues)
        .set({
          credentialsEnc: this.secrets.encrypt(JSON.stringify({ refreshToken })),
          connectedAs: email,
          syncCursor: null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(mailboxQueues.id, queueId));
      await this.audit.record(
        {
          eventType: 'settings.updated',
          actorUserId: userId,
          targetType: 'mailbox',
          targetId: queueId,
          details: { connected: email },
        },
        tx,
      );
    });
  }

  async disconnect(auth: AuthContext, id: string, ip: string | null) {
    await this.find(id);
    await this.db.transaction(async (tx) => {
      await tx
        .update(mailboxQueues)
        .set({ credentialsEnc: null, connectedAs: null, syncCursor: null })
        .where(eq(mailboxQueues.id, id));
      await this.audit.record(
        {
          eventType: 'settings.updated',
          actorUserId: auth.user.id,
          ip,
          targetType: 'mailbox',
          targetId: id,
          details: { disconnected: true },
        },
        tx,
      );
    });
  }

  ref(row: MailboxRow): MailboxRef {
    return {
      id: row.id,
      address: row.address,
      provider: row.provider,
      credentials: row.credentialsEnc
        ? (JSON.parse(this.secrets.decrypt(row.credentialsEnc)) as Record<string, string>)
        : null,
      cursor: row.syncCursor,
    };
  }

  async find(id: string): Promise<MailboxRow> {
    const [row] = await this.db
      .select()
      .from(mailboxQueues)
      .where(and(eq(mailboxQueues.id, id), isNull(mailboxQueues.deletedAt)));
    if (!row) throw new NotFoundException({ message: 'Unknown mailbox.', reason: 'unknown_mailbox' });
    return row;
  }

  async allAddresses(): Promise<string[]> {
    return (await this.db.select({ a: mailboxQueues.address }).from(mailboxQueues)).map((r) => r.a);
  }

  async crmDatabasesOf(queueId: string): Promise<string[]> {
    return (
      await this.db.select().from(mailboxQueueCrmDatabases).where(eq(mailboxQueueCrmDatabases.queueId, queueId))
    ).map((l) => l.crmDatabaseId);
  }

  private async check(input: MailboxInput) {
    const [cat] = await this.db
      .select()
      .from(categories)
      .where(and(eq(categories.id, input.defaultCategoryId), isNull(categories.deletedAt)));
    if (!cat) throw new BadRequestException({ message: 'Unknown category.', reason: 'unknown_category' });
    if (input.crmDatabaseIds.length) {
      const found = await this.db
        .select({ id: crmDatabases.id })
        .from(crmDatabases)
        .where(inArray(crmDatabases.id, input.crmDatabaseIds));
      if (found.length !== new Set(input.crmDatabaseIds).size)
        throw new BadRequestException({ message: 'Unknown CRM database.', reason: 'unknown_reference' });
    }
    if (input.autoResponseEnabled && !input.autoResponseTemplateId) {
      throw new BadRequestException({
        message: 'Choose an auto-response template, or turn auto-responses off.',
        reason: 'template_required',
      });
    }
  }
}

/** Never includes credentials. */
export function publicMailbox(r: MailboxRow, crmDatabaseIds: string[]) {
  return {
    id: r.id,
    title: r.title,
    address: r.address,
    senderName: r.senderName,
    provider: r.provider,
    defaultCategoryId: r.defaultCategoryId,
    headerThreading: r.headerThreading,
    active: r.active,
    autoResponseEnabled: r.autoResponseEnabled,
    autoResponseNewOnly: r.autoResponseNewOnly,
    autoResponseTemplateId: r.autoResponseTemplateId,
    defaultBodyTemplateId: r.defaultBodyTemplateId,
    crmDatabaseIds,
    connected: !!r.credentialsEnc,
    connectedAs: r.connectedAs,
    lastSyncAt: r.lastSyncAt,
    lastError: r.lastError,
  };
}
