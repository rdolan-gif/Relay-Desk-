import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import {
  canSeeCrmDatabase,
  canSeeRecordType,
  canSeeUser,
  diffFields,
  flattenForHistory,
  isValidRecordStatus,
  recordTypeScope,
  type CustomValues,
  type RecordStage,
} from '@relay-desk/domain';
import type { AuthContext } from '../common/request-context';
import { DB, type Db } from '../db/db';
import { accounts, contacts, crmRecordTypes, crmRecords, users } from '../db/schema';
import { HistoryService } from '../history/history.service';
import { AccountsService } from './accounts.service';
import { ContactsService } from './contacts.service';
import { applyCustomInput, filterFields, filterSql, likeTerm, pageOf, scopeSql, type ListQuery } from './crm-common';
import { CustomFieldsService } from './custom-fields.service';

export interface RecordInput {
  recordTypeId?: string;
  title?: string;
  status?: string | null;
  stage?: RecordStage;
  contactId?: string | null;
  accountId?: string | null;
  userId?: string | null;
  customFields?: Record<string, unknown>;
}

type Row = typeof crmRecords.$inferSelect;

const SORTS: Record<string, SQL> = {
  title: sql`lower(${crmRecords.title})`,
  createdAt: sql`${crmRecords.createdAt}`,
  updatedAt: sql`${crmRecords.updatedAt}`,
};

const flat = (r: Row) =>
  flattenForHistory(
    {
      title: r.title,
      recordTypeId: r.recordTypeId,
      status: r.status,
      stage: r.stage,
      contactId: r.contactId,
      accountId: r.accountId,
      userId: r.userId,
    },
    r.customFields,
  );

/** CRM records (spec 12.2): visible when their record type is in the caller's rights. */
@Injectable()
export class RecordsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(HistoryService) private readonly history: HistoryService,
    @Inject(CustomFieldsService) private readonly fields: CustomFieldsService,
    @Inject(ContactsService) private readonly contactsService: ContactsService,
    @Inject(AccountsService) private readonly accountsService: AccountsService,
  ) {}

  async list(auth: AuthContext, q: ListQuery, extra: SQL[] = []) {
    const fieldMap = await this.fields.map();
    const where: (SQL | undefined)[] = [
      isNull(crmRecords.deletedAt),
      scopeSql(crmRecords.recordTypeId, recordTypeScope(auth.rights)),
      ...extra,
    ];
    if (q.q) where.push(this.searchSql(q.q));
    where.push(
      ...filterSql(
        q.filter,
        filterFields('records', fieldMap.values()),
        {
          title: sql`${crmRecords.title}`,
          recordTypeId: sql`${crmRecords.recordTypeId}`,
          status: sql`${crmRecords.status}`,
          stage: sql`${crmRecords.stage}`,
          userId: sql`${crmRecords.userId}`,
          contactId: sql`${crmRecords.contactId}`,
          accountId: sql`${crmRecords.accountId}`,
          createdAt: sql`${crmRecords.createdAt}`,
          updatedAt: sql`${crmRecords.updatedAt}`,
        },
        sql`${crmRecords.customFields}`,
      ),
    );
    const cond = and(...where);
    const sortCol = SORTS[q.sort ?? 'title'] ?? SORTS.title!;
    const rows = await this.db
      .select({
        record: crmRecords,
        recordTypeTitle: crmRecordTypes.title,
        contactName: contacts.name,
        contactDatabaseId: contacts.databaseId,
        accountName: accounts.name,
        accountDatabaseId: accounts.databaseId,
        userName: users.name,
      })
      .from(crmRecords)
      .innerJoin(crmRecordTypes, eq(crmRecordTypes.id, crmRecords.recordTypeId))
      .leftJoin(contacts, eq(contacts.id, crmRecords.contactId))
      .leftJoin(accounts, eq(accounts.id, crmRecords.accountId))
      .leftJoin(users, eq(users.id, crmRecords.userId))
      .where(cond)
      .orderBy(q.dir === 'desc' ? desc(sortCol) : asc(sortCol), asc(crmRecords.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [{ total }] = (await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(crmRecords)
      .where(cond)) as [{ total: number }];
    return pageOf(
      rows.map((r) => ({
        ...publicRecord(r.record),
        recordTypeTitle: r.recordTypeTitle,
        // Linked names are shown only when the caller can see that contact/account's database.
        contactName: r.contactDatabaseId && canSeeCrmDatabase(auth.rights, r.contactDatabaseId) ? r.contactName : null,
        accountName: r.accountDatabaseId && canSeeCrmDatabase(auth.rights, r.accountDatabaseId) ? r.accountName : null,
        userName: r.userName,
      })),
      total,
      q,
    );
  }

  searchSql(term: string): SQL {
    return sql`${crmRecords.title} ilike ${likeTerm(term)}`;
  }

  async get(auth: AuthContext, id: string) {
    const row = await this.find(auth, id);
    const [type] = await this.db
      .select({ id: crmRecordTypes.id, title: crmRecordTypes.title })
      .from(crmRecordTypes)
      .where(eq(crmRecordTypes.id, row.recordTypeId));
    return { ...publicRecord(row), recordType: type ?? null };
  }

  async create(auth: AuthContext, input: RecordInput & { recordTypeId: string; title: string }) {
    const type = await this.visibleType(auth, input.recordTypeId);
    const status = input.status ?? null;
    if (!isValidRecordStatus(type.statuses, status))
      throw new BadRequestException({ message: 'Unknown status for this record type.', reason: 'invalid_status' });
    const links = await this.checkLinks(auth, {
      contactId: input.contactId ?? null,
      accountId: input.accountId ?? null,
      userId: input.userId ?? null,
    });
    const customFields = await applyCustomInput({
      db: this.db,
      auth,
      layout: type.formLayout,
      fields: await this.fields.map(),
      current: {},
      input: input.customFields,
      isCreate: true,
    });
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(crmRecords)
        .values({
          recordTypeId: type.id,
          title: input.title.trim(),
          status,
          stage: input.stage ?? 'open',
          ...links,
          customFields,
        })
        .returning();
      await this.history.record(tx, auth, 'crm_record', row!.id, 'create', diffFields({}, flat(row!)));
      return publicRecord(row!);
    });
  }

  async update(auth: AuthContext, id: string, input: RecordInput) {
    const before = await this.find(auth, id);
    const type = await this.visibleType(auth, input.recordTypeId ?? before.recordTypeId);
    const status = input.status !== undefined ? input.status : before.status;
    if (!isValidRecordStatus(type.statuses, status))
      throw new BadRequestException({ message: 'Unknown status for this record type.', reason: 'invalid_status' });
    const links = await this.checkLinks(auth, {
      contactId: input.contactId !== undefined ? input.contactId : before.contactId,
      accountId: input.accountId !== undefined ? input.accountId : before.accountId,
      userId: input.userId !== undefined ? input.userId : before.userId,
    });
    const customFields = await applyCustomInput({
      db: this.db,
      auth,
      layout: type.formLayout,
      fields: await this.fields.map(),
      current: before.customFields as CustomValues,
      input: input.customFields,
      isCreate: false,
    });
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(crmRecords)
        .set({
          recordTypeId: type.id,
          title: input.title?.trim() ?? before.title,
          status,
          stage: input.stage ?? before.stage,
          ...links,
          customFields,
          updatedAt: new Date(),
        })
        .where(eq(crmRecords.id, id))
        .returning();
      await this.history.record(tx, auth, 'crm_record', id, 'update', diffFields(flat(before), flat(row!)));
      return publicRecord(row!);
    });
  }

  async remove(auth: AuthContext, id: string) {
    await this.find(auth, id);
    await this.db.transaction(async (tx) => {
      await tx.update(crmRecords).set({ deletedAt: new Date() }).where(eq(crmRecords.id, id));
      await this.history.record(tx, auth, 'crm_record', id, 'delete', []);
    });
  }

  async historyOf(auth: AuthContext, id: string) {
    await this.find(auth, id);
    return this.history.list('crm_record', id);
  }

  async snapshot(auth: AuthContext, id: string, at: Date) {
    const row = await this.find(auth, id);
    const snap = await this.history.snapshot('crm_record', id, flat(row), at);
    if (!snap)
      throw new NotFoundException({ message: 'The record did not exist at that time.', reason: 'not_yet_created' });
    return { at: at.toISOString(), ...snap.core, customFields: snap.custom };
  }

  async find(auth: AuthContext, id: string): Promise<Row> {
    const [row] = await this.db
      .select()
      .from(crmRecords)
      .where(and(eq(crmRecords.id, id), isNull(crmRecords.deletedAt)));
    if (!row || !canSeeRecordType(auth.rights, row.recordTypeId)) throw new NotFoundException();
    return row;
  }

  private async visibleType(auth: AuthContext, id: string) {
    const [row] = await this.db
      .select()
      .from(crmRecordTypes)
      .where(and(eq(crmRecordTypes.id, id), isNull(crmRecordTypes.deletedAt)));
    if (!row || !canSeeRecordType(auth.rights, id)) {
      throw new NotFoundException({ message: 'Unknown record type.', reason: 'unknown_record_type' });
    }
    return row;
  }

  /** Linked contact/account must be visible to the caller; the owner must be a visible, active user. */
  private async checkLinks(
    auth: AuthContext,
    links: { contactId: string | null; accountId: string | null; userId: string | null },
  ) {
    const bad = (what: string) => new BadRequestException({ message: `Unknown ${what}.`, reason: `unknown_${what}` });
    if (links.contactId)
      await this.contactsService.find(auth, links.contactId).catch(() => Promise.reject(bad('contact')));
    if (links.accountId)
      await this.accountsService.find(auth, links.accountId).catch(() => Promise.reject(bad('account')));
    if (links.userId) {
      const [u] = await this.db
        .select()
        .from(users)
        .where(and(eq(users.id, links.userId), isNull(users.deletedAt)));
      if (!u || !u.isActive || !canSeeUser(auth.rights, auth.user.id, u.id)) throw bad('user');
    }
    return links;
  }
}

export function publicRecord(r: Row) {
  return {
    id: r.id,
    recordTypeId: r.recordTypeId,
    title: r.title,
    status: r.status,
    stage: r.stage,
    contactId: r.contactId,
    accountId: r.accountId,
    userId: r.userId,
    customFields: r.customFields,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
