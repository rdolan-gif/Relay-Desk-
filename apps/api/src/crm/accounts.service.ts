import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import {
  canSeeCrmDatabase,
  crmDatabaseScope,
  diffFields,
  flattenForHistory,
  type CustomValues,
} from '@relay-desk/domain';
import type { AuthContext } from '../common/request-context';
import { DB, type Db } from '../db/db';
import { accounts, contacts, crmDatabases } from '../db/schema';
import { HistoryService } from '../history/history.service';
import { applyCustomInput, filterFields, filterSql, likeTerm, pageOf, scopeSql, type ListQuery } from './crm-common';
import { publicContact } from './contacts.service';
import { CustomFieldsService } from './custom-fields.service';

export interface AccountInput {
  databaseId?: string;
  name?: string;
  customFields?: Record<string, unknown>;
}

type Row = typeof accounts.$inferSelect;

const SORTS: Record<string, SQL> = {
  name: sql`lower(${accounts.name})`,
  createdAt: sql`${accounts.createdAt}`,
  updatedAt: sql`${accounts.updatedAt}`,
};

const flat = (r: Row) => flattenForHistory({ name: r.name, databaseId: r.databaseId }, r.customFields);

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(HistoryService) private readonly history: HistoryService,
    @Inject(CustomFieldsService) private readonly fields: CustomFieldsService,
  ) {}

  async list(auth: AuthContext, q: ListQuery) {
    const fieldMap = await this.fields.map();
    const where: (SQL | undefined)[] = [
      isNull(accounts.deletedAt),
      scopeSql(accounts.databaseId, crmDatabaseScope(auth.rights)),
    ];
    if (q.q) where.push(this.searchSql(q.q));
    where.push(
      ...filterSql(
        q.filter,
        filterFields('accounts', fieldMap.values()),
        {
          name: sql`${accounts.name}`,
          databaseId: sql`${accounts.databaseId}`,
          createdAt: sql`${accounts.createdAt}`,
          updatedAt: sql`${accounts.updatedAt}`,
        },
        sql`${accounts.customFields}`,
      ),
    );
    const cond = and(...where);
    const sortCol = SORTS[q.sort ?? 'name'] ?? SORTS.name!;
    const rows = await this.db
      .select({
        account: accounts,
        databaseTitle: crmDatabases.title,
        contactCount: sql<number>`(select count(*)::int from contacts c where c.account_id = ${accounts.id} and c.deleted_at is null)`,
      })
      .from(accounts)
      .innerJoin(crmDatabases, eq(crmDatabases.id, accounts.databaseId))
      .where(cond)
      .orderBy(q.dir === 'desc' ? desc(sortCol) : asc(sortCol), asc(accounts.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [{ total }] = (await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(accounts)
      .where(cond)) as [{ total: number }];
    return pageOf(
      rows.map((r) => ({ ...publicAccount(r.account), databaseTitle: r.databaseTitle, contactCount: r.contactCount })),
      total,
      q,
    );
  }

  searchSql(term: string): SQL {
    return sql`${accounts.name} ilike ${likeTerm(term)}`;
  }

  async get(auth: AuthContext, id: string) {
    const row = await this.find(auth, id);
    const [database] = await this.db
      .select({ id: crmDatabases.id, title: crmDatabases.title })
      .from(crmDatabases)
      .where(eq(crmDatabases.id, row.databaseId));
    return { ...publicAccount(row), database: database ?? null };
  }

  /** The account's contacts (same database, so visible whenever the account is). */
  async contactsOf(auth: AuthContext, id: string) {
    await this.find(auth, id);
    const rows = await this.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.accountId, id), isNull(contacts.deletedAt)))
      .orderBy(asc(contacts.name));
    return rows.map(publicContact);
  }

  async create(auth: AuthContext, input: AccountInput & { databaseId: string; name: string }) {
    const database = await this.visibleDatabase(auth, input.databaseId);
    const customFields = await applyCustomInput({
      db: this.db,
      auth,
      layout: database.accountFormLayout,
      fields: await this.fields.map(),
      current: {},
      input: input.customFields,
      isCreate: true,
    });
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(accounts)
        .values({ databaseId: database.id, name: input.name.trim(), customFields })
        .returning();
      await this.history.record(tx, auth, 'account', row!.id, 'create', diffFields({}, flat(row!)));
      return publicAccount(row!);
    });
  }

  async update(auth: AuthContext, id: string, input: AccountInput) {
    const before = await this.find(auth, id);
    const database = await this.visibleDatabase(auth, input.databaseId ?? before.databaseId);
    if (database.id !== before.databaseId) {
      const linked = await this.db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.accountId, id), isNull(contacts.deletedAt)))
        .limit(1);
      if (linked.length) {
        throw new ConflictException({
          message: 'Move or unlink the account’s contacts before moving it to another database.',
          reason: 'account_has_contacts',
        });
      }
    }
    const customFields = await applyCustomInput({
      db: this.db,
      auth,
      layout: database.accountFormLayout,
      fields: await this.fields.map(),
      current: before.customFields as CustomValues,
      input: input.customFields,
      isCreate: false,
    });
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(accounts)
        .set({ databaseId: database.id, name: input.name?.trim() ?? before.name, customFields, updatedAt: new Date() })
        .where(eq(accounts.id, id))
        .returning();
      await this.history.record(tx, auth, 'account', id, 'update', diffFields(flat(before), flat(row!)));
      return publicAccount(row!);
    });
  }

  async remove(auth: AuthContext, id: string) {
    await this.find(auth, id);
    const linked = await this.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.accountId, id), isNull(contacts.deletedAt)))
      .limit(1);
    if (linked.length)
      throw new ConflictException({ message: 'Unlink the account’s contacts first.', reason: 'account_has_contacts' });
    await this.db.transaction(async (tx) => {
      await tx.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, id));
      await this.history.record(tx, auth, 'account', id, 'delete', []);
    });
  }

  async historyOf(auth: AuthContext, id: string) {
    await this.find(auth, id);
    return this.history.list('account', id);
  }

  async snapshot(auth: AuthContext, id: string, at: Date) {
    const row = await this.find(auth, id);
    const snap = await this.history.snapshot('account', id, flat(row), at);
    if (!snap)
      throw new NotFoundException({ message: 'The account did not exist at that time.', reason: 'not_yet_created' });
    return { at: at.toISOString(), ...snap.core, customFields: snap.custom };
  }

  async find(auth: AuthContext, id: string): Promise<Row> {
    const [row] = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)));
    if (!row || !canSeeCrmDatabase(auth.rights, row.databaseId)) throw new NotFoundException();
    return row;
  }

  private async visibleDatabase(auth: AuthContext, id: string) {
    const [row] = await this.db
      .select()
      .from(crmDatabases)
      .where(and(eq(crmDatabases.id, id), isNull(crmDatabases.deletedAt)));
    if (!row || !canSeeCrmDatabase(auth.rights, id)) {
      throw new NotFoundException({ message: 'Unknown CRM database.', reason: 'unknown_database' });
    }
    return row;
  }
}

export function publicAccount(r: Row) {
  return {
    id: r.id,
    databaseId: r.databaseId,
    name: r.name,
    customFields: r.customFields,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
