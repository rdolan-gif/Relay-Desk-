import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  accountPath,
  canSeeCrmDatabase,
  checkBranchParent,
  crmDatabaseScope,
  diffFields,
  flattenForHistory,
  normaliseAddress,
  normaliseContactIdentifiers,
  type Address,
  type CustomValues,
} from '@relay-desk/domain';
import { alias } from 'drizzle-orm/pg-core';
import type { AuthContext } from '../common/request-context';
import { DB, type Db } from '../db/db';
import { accounts, contacts, crmDatabases, slaDefinitions } from '../db/schema';
import { formError } from './form-errors';
import { SlaService } from '../sla/sla.service';
import { HistoryService } from '../history/history.service';
import { applyCustomInput, filterFields, filterSql, likeTerm, pageOf, scopeSql, type ListQuery } from './crm-common';
import { publicContact } from './contacts.service';
import { CustomFieldsService } from './custom-fields.service';

export interface AccountInput {
  databaseId?: string;
  name?: string;
  /** The company this account is a branch of (owner Q2). */
  parentId?: string | null;
  branchCode?: string | null;
  emails?: string[];
  phones?: string[];
  addresses?: Address[];
  customFields?: Record<string, unknown>;
  /** Overrides the category SLA for this account's contacts (spec 8). */
  slaId?: string | null;
}

type Row = typeof accounts.$inferSelect;
const parents = alias(accounts, 'parent');

const SORTS: Record<string, SQL> = {
  // Companies sort with their branches: "Northgate › Leeds" sits after "Northgate".
  name: sql`lower(coalesce(${parents.name} || ' › ', '') || ${accounts.name})`,
  createdAt: sql`${accounts.createdAt}`,
  updatedAt: sql`${accounts.updatedAt}`,
};

const flat = (r: Row) =>
  flattenForHistory(
    {
      name: r.name,
      databaseId: r.databaseId,
      parentId: r.parentId,
      branchCode: r.branchCode,
      slaId: r.slaId,
      emails: r.emails,
      phones: r.phones,
      addresses: r.addresses,
    },
    r.customFields,
  );

/**
 * Accounts (spec 12.2) with Company › Branch › Branch number (owner Q2): a branch is an
 * account whose parent is a company; each can hold phones, emails and delivery
 * addresses that show on the contact card.
 */
@Injectable()
export class AccountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(HistoryService) private readonly history: HistoryService,
    @Inject(CustomFieldsService) private readonly fields: CustomFieldsService,
    @Inject(SlaService) private readonly sla: SlaService,
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
          parentId: sql`${accounts.parentId}`,
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
        parentName: parents.name,
        databaseTitle: crmDatabases.title,
        contactCount: sql<number>`(select count(*)::int from contacts c where c.account_id = ${accounts.id} and c.deleted_at is null)`,
        branchCount: sql<number>`(select count(*)::int from accounts b where b.parent_id = ${accounts.id} and b.deleted_at is null)`,
      })
      .from(accounts)
      .leftJoin(parents, eq(parents.id, accounts.parentId))
      .innerJoin(crmDatabases, eq(crmDatabases.id, accounts.databaseId))
      .where(cond)
      .orderBy(q.dir === 'desc' ? desc(sortCol) : asc(sortCol), asc(accounts.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [{ total }] = (await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(accounts)
      .leftJoin(parents, eq(parents.id, accounts.parentId))
      .where(cond)) as [{ total: number }];
    return pageOf(
      rows.map((r) => ({
        ...publicAccount(r.account, r.parentName),
        databaseTitle: r.databaseTitle,
        contactCount: r.contactCount,
        branchCount: r.branchCount,
      })),
      total,
      q,
    );
  }

  /** Name, branch number, or the company name for its branches. Lists must join `parents`. */
  searchSql(term: string): SQL {
    const like = likeTerm(term);
    return or(
      sql`${accounts.name} ilike ${like}`,
      sql`${accounts.branchCode} ilike ${like}`,
      sql`${parents.name} ilike ${like}`,
    )!;
  }

  /** Search usable without the parent join (global search). */
  searchSqlStandalone(term: string): SQL {
    const like = likeTerm(term);
    return or(
      sql`${accounts.name} ilike ${like}`,
      sql`${accounts.branchCode} ilike ${like}`,
      sql`exists (select 1 from accounts p where p.id = ${accounts.parentId} and p.name ilike ${like})`,
    )!;
  }

  async get(auth: AuthContext, id: string) {
    const row = await this.find(auth, id);
    const [database] = await this.db
      .select({ id: crmDatabases.id, title: crmDatabases.title })
      .from(crmDatabases)
      .where(eq(crmDatabases.id, row.databaseId));
    const [parent] = row.parentId
      ? await this.db
          .select({ id: accounts.id, name: accounts.name })
          .from(accounts)
          .where(eq(accounts.id, row.parentId))
      : [];
    const branches = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.parentId, id), isNull(accounts.deletedAt)))
      .orderBy(asc(accounts.name));
    return {
      ...publicAccount(row, parent?.name ?? null),
      database: database ?? null,
      parent: parent ?? null,
      branches: branches.map((b) => publicAccount(b, row.name)),
    };
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

  /** This account plus, for a company, all its branches: whose contacts' tickets belong here. */
  async familyIds(auth: AuthContext, id: string): Promise<string[]> {
    await this.find(auth, id);
    const branches = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.parentId, id), isNull(accounts.deletedAt)));
    return [id, ...branches.map((b) => b.id)];
  }

  async create(auth: AuthContext, input: AccountInput & { databaseId: string; name: string }) {
    const database = await this.visibleDatabase(auth, input.databaseId);
    const details = this.details(input, { emails: [], phones: [], addresses: [] });
    const parentId = await this.checkParent(auth, null, database.id, input.parentId ?? null);
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
        .values({
          databaseId: database.id,
          name: input.name.trim(),
          parentId,
          branchCode: input.branchCode?.trim() || null,
          slaId: await this.checkSla(input.slaId ?? null),
          ...details,
          customFields,
        })
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
    const details = this.details(input, before);
    const parentId = await this.checkParent(
      auth,
      id,
      database.id,
      input.parentId !== undefined ? input.parentId : before.parentId,
    );
    const customFields = await applyCustomInput({
      db: this.db,
      auth,
      layout: database.accountFormLayout,
      fields: await this.fields.map(),
      current: before.customFields as CustomValues,
      input: input.customFields,
      isCreate: false,
    });
    const slaId = input.slaId !== undefined ? await this.checkSla(input.slaId) : before.slaId;
    const out = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(accounts)
        .set({
          databaseId: database.id,
          name: input.name?.trim() ?? before.name,
          parentId,
          branchCode: input.branchCode !== undefined ? input.branchCode?.trim() || null : before.branchCode,
          slaId,
          ...details,
          customFields,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, id))
        .returning();
      await this.history.record(tx, auth, 'account', id, 'update', diffFields(flat(before), flat(row!)));
      return publicAccount(row!);
    });
    if (slaId !== before.slaId) await this.sla.refreshAccount(id);
    return out;
  }

  private async checkSla(id: string | null): Promise<string | null> {
    if (!id) return null;
    const [r] = await this.db
      .select({ id: slaDefinitions.id })
      .from(slaDefinitions)
      .where(and(eq(slaDefinitions.id, id), isNull(slaDefinitions.deletedAt)));
    if (!r) throw formError(['Unknown SLA.'], 'invalid_account');
    return id;
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
    const branches = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.parentId, id), isNull(accounts.deletedAt)))
      .limit(1);
    if (branches.length)
      throw new ConflictException({
        message: 'Delete or move the company’s branches first.',
        reason: 'account_has_branches',
      });
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

  /** Account summary for the ticket's contact card: path, contact details, delivery addresses. */
  async cardSummary(accountId: string) {
    const [a] = await this.db.select().from(accounts).where(eq(accounts.id, accountId));
    if (!a) return null;
    const [parent] = a.parentId ? await this.db.select().from(accounts).where(eq(accounts.id, a.parentId)) : [];
    return {
      id: a.id,
      name: a.name,
      path: accountPath(parent?.name ?? null, a.name, a.branchCode),
      company: parent ? { id: parent.id, name: parent.name } : null,
      branchCode: a.branchCode,
      emails: a.emails,
      phones: a.phones,
      deliveryAddresses: a.addresses.filter((ad) => ad.isDelivery),
    };
  }

  /** Normalises phones, emails and addresses; unchanged values carry over from `before`. */
  private details(input: AccountInput, before: Pick<Row, 'emails' | 'phones' | 'addresses'>) {
    const ids = normaliseContactIdentifiers({
      emails: input.emails ?? before.emails,
      phones: input.phones ?? before.phones,
    });
    if (!ids.ok) {
      const messages = [...ids.errors.emails, ...ids.errors.phones].map((e) => e.error);
      throw new BadRequestException({ message: messages.join(' '), reason: 'invalid_identifiers', errors: ids.errors });
    }
    const addresses: Address[] = [];
    for (const a of input.addresses ?? before.addresses) {
      const r = normaliseAddress(a);
      if (!r.ok) throw new BadRequestException({ message: r.error, reason: 'invalid_address' });
      addresses.push(r.address);
    }
    return { emails: ids.emails, phones: ids.phones, addresses };
  }

  private async checkParent(auth: AuthContext, accountId: string | null, databaseId: string, parentId: string | null) {
    if (!parentId) return null;
    const parent = await this.find(auth, parentId).catch(() => {
      throw new BadRequestException({ message: 'Unknown company.', reason: 'unknown_parent' });
    });
    const hasBranches = accountId
      ? (
          await this.db
            .select({ id: accounts.id })
            .from(accounts)
            .where(and(eq(accounts.parentId, accountId), isNull(accounts.deletedAt)))
            .limit(1)
        ).length > 0
      : false;
    const check = checkBranchParent({ accountId, databaseId, parent, hasBranches });
    if (!check.ok) throw new BadRequestException({ message: check.error, reason: 'invalid_parent' });
    return parentId;
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

export function publicAccount(r: Row, parentName: string | null = null) {
  return {
    id: r.id,
    databaseId: r.databaseId,
    name: r.name,
    parentId: r.parentId,
    parentName,
    branchCode: r.branchCode,
    slaId: r.slaId,
    path: accountPath(parentName, r.name, r.branchCode),
    emails: r.emails,
    phones: r.phones,
    addresses: r.addresses,
    customFields: r.customFields,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
