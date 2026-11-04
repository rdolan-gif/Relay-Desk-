import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  canLinkContactToAccount,
  canSeeCrmDatabase,
  crmDatabaseScope,
  diffFields,
  flattenForHistory,
  normaliseContactIdentifiers,
  normaliseEmailAddress,
  normalisePhone,
  type CustomValues,
} from '@relay-desk/domain';
import type { AuthContext } from '../common/request-context';
import { DB, type Db, type DbOrTx } from '../db/db';
import { accounts, contacts, crmDatabases } from '../db/schema';
import { SlaService } from '../sla/sla.service';
import { HistoryService } from '../history/history.service';
import { applyCustomInput, filterFields, filterSql, likeTerm, pageOf, scopeSql, type ListQuery } from './crm-common';
import { CustomFieldsService } from './custom-fields.service';

export interface ContactInput {
  databaseId?: string;
  name?: string;
  emails?: string[];
  phones?: string[];
  accountId?: string | null;
  customFields?: Record<string, unknown>;
}

type Row = typeof contacts.$inferSelect;

const SORTS: Record<string, SQL> = {
  name: sql`lower(${contacts.name})`,
  createdAt: sql`${contacts.createdAt}`,
  updatedAt: sql`${contacts.updatedAt}`,
};

export function contactFlat(r: Pick<Row, 'name' | 'emails' | 'phones' | 'accountId' | 'databaseId' | 'customFields'>) {
  return flattenForHistory(
    { name: r.name, emails: r.emails, phones: r.phones, accountId: r.accountId, databaseId: r.databaseId },
    r.customFields,
  );
}

@Injectable()
export class ContactsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(HistoryService) private readonly history: HistoryService,
    @Inject(CustomFieldsService) private readonly fields: CustomFieldsService,
    @Inject(SlaService) private readonly sla: SlaService,
  ) {}

  /** Lists only contacts in CRM databases the caller's rights include (spec 4, 12.1). */
  async list(auth: AuthContext, q: ListQuery) {
    const fieldMap = await this.fields.map();
    const where: (SQL | undefined)[] = [
      isNull(contacts.deletedAt),
      scopeSql(contacts.databaseId, crmDatabaseScope(auth.rights)),
    ];
    if (q.q) where.push(this.searchSql(q.q));
    where.push(
      ...filterSql(
        q.filter,
        filterFields('contacts', fieldMap.values()),
        {
          name: sql`${contacts.name}`,
          emails: sql`${contacts.emails}`,
          phones: sql`${contacts.phones}`,
          accountId: sql`${contacts.accountId}`,
          databaseId: sql`${contacts.databaseId}`,
          createdAt: sql`${contacts.createdAt}`,
          updatedAt: sql`${contacts.updatedAt}`,
        },
        sql`${contacts.customFields}`,
      ),
    );
    const cond = and(...where);
    const sortCol = SORTS[q.sort ?? 'name'] ?? SORTS.name!;
    const rows = await this.db
      .select({ contact: contacts, accountName: accounts.name, databaseTitle: crmDatabases.title })
      .from(contacts)
      .leftJoin(accounts, eq(accounts.id, contacts.accountId))
      .innerJoin(crmDatabases, eq(crmDatabases.id, contacts.databaseId))
      .where(cond)
      .orderBy(q.dir === 'desc' ? desc(sortCol) : asc(sortCol), asc(contacts.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [{ total }] = (await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(contacts)
      .where(cond)) as [{ total: number }];
    return pageOf(
      rows.map((r) => ({ ...publicContact(r.contact), accountName: r.accountName, databaseTitle: r.databaseTitle })),
      total,
      q,
    );
  }

  /** Name, any email, or (3+ digits) any phone. Used by the list `q` and global search. */
  searchSql(term: string): SQL {
    const like = likeTerm(term);
    const digits = term.replace(/\D/g, '');
    const parts: SQL[] = [
      sql`${contacts.name} ilike ${like}`,
      sql`exists (select 1 from unnest(${contacts.emails}) e where e ilike ${like})`,
    ];
    if (digits.length >= 3) {
      parts.push(
        sql`exists (select 1 from unnest(${contacts.phones}) p where regexp_replace(p, '\\D', '', 'g') like ${likeTerm(digits)})`,
      );
    }
    return or(...parts)!;
  }

  /**
   * Visible contacts sharing any of the given emails or phones (after normalisation).
   * Used to warn about likely duplicates before saving; never blocks (Q-P1-9).
   */
  async findDuplicates(auth: AuthContext, input: { emails: string[]; phones: string[]; excludeId?: string }) {
    const emails = input.emails.map((e) => normaliseEmailAddress(e)).flatMap((r) => (r.ok ? [r.value] : []));
    const phones = input.phones.map((p) => normalisePhone(p)).flatMap((r) => (r.ok ? [r.value] : []));
    if (!emails.length && !phones.length) return [];
    const match: SQL[] = [];
    if (emails.length)
      match.push(
        sql`${contacts.emails} && ${sql`array[${sql.join(
          emails.map((e) => sql`${e}`),
          sql`, `,
        )}]::text[]`}`,
      );
    if (phones.length)
      match.push(
        sql`${contacts.phones} && ${sql`array[${sql.join(
          phones.map((p) => sql`${p}`),
          sql`, `,
        )}]::text[]`}`,
      );
    const rows = await this.db
      .select({ id: contacts.id, name: contacts.name, emails: contacts.emails, phones: contacts.phones })
      .from(contacts)
      .where(
        and(
          isNull(contacts.deletedAt),
          scopeSql(contacts.databaseId, crmDatabaseScope(auth.rights)),
          input.excludeId ? ne(contacts.id, input.excludeId) : undefined,
          or(...match),
        ),
      )
      .limit(10);
    return rows;
  }

  async get(auth: AuthContext, id: string) {
    const row = await this.find(auth, id);
    const [account] = row.accountId
      ? await this.db
          .select({ id: accounts.id, name: accounts.name })
          .from(accounts)
          .where(eq(accounts.id, row.accountId))
      : [];
    const [database] = await this.db
      .select({ id: crmDatabases.id, title: crmDatabases.title })
      .from(crmDatabases)
      .where(eq(crmDatabases.id, row.databaseId));
    return { ...publicContact(row), account: account ?? null, database: database ?? null };
  }

  async create(auth: AuthContext, input: ContactInput & { databaseId: string; name: string }) {
    const database = await this.visibleDatabase(auth, input.databaseId);
    const ids = this.identifiers(input.emails ?? [], input.phones ?? []);
    const accountId = await this.checkAccount(input.accountId ?? null, database.id);
    const customFields = await applyCustomInput({
      db: this.db,
      auth,
      layout: database.contactFormLayout,
      fields: await this.fields.map(),
      current: {},
      input: input.customFields,
      isCreate: true,
    });
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(contacts)
        .values({
          databaseId: database.id,
          name: input.name.trim(),
          emails: ids.emails,
          phones: ids.phones,
          accountId,
          customFields,
        })
        .returning();
      await this.history.record(tx, auth, 'contact', row!.id, 'create', diffFields({}, contactFlat(row!)));
      return publicContact(row!);
    });
  }

  async update(auth: AuthContext, id: string, input: ContactInput) {
    const before = await this.find(auth, id);
    const database = await this.visibleDatabase(auth, input.databaseId ?? before.databaseId);
    const emails = input.emails ?? before.emails;
    const phones = input.phones ?? before.phones;
    const ids = this.identifiers(emails, phones);
    const accountId = await this.checkAccount(
      input.accountId !== undefined ? input.accountId : before.accountId,
      database.id,
    );
    const customFields = await applyCustomInput({
      db: this.db,
      auth,
      layout: database.contactFormLayout,
      fields: await this.fields.map(),
      current: before.customFields as CustomValues,
      input: input.customFields,
      isCreate: false,
    });
    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(contacts)
        .set({
          databaseId: database.id,
          name: input.name?.trim() ?? before.name,
          emails: ids.emails,
          phones: ids.phones,
          accountId,
          customFields,
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, id))
        .returning();
      await this.history.record(tx, auth, 'contact', id, 'update', diffFields(contactFlat(before), contactFlat(row!)));
      return row!;
    });
    // A different account can bring a different SLA (spec 8).
    if (updated.accountId !== before.accountId) await this.sla.refreshContact(id);
    return publicContact(updated);
  }

  async remove(auth: AuthContext, id: string) {
    await this.find(auth, id);
    await this.db.transaction(async (tx) => {
      await tx.update(contacts).set({ deletedAt: new Date() }).where(eq(contacts.id, id));
      await this.history.record(tx, auth, 'contact', id, 'delete', []);
    });
  }

  async historyOf(auth: AuthContext, id: string) {
    await this.find(auth, id);
    return this.history.list('contact', id);
  }

  async snapshot(auth: AuthContext, id: string, at: Date) {
    const row = await this.find(auth, id);
    const snap = await this.history.snapshot('contact', id, contactFlat(row), at);
    if (!snap)
      throw new NotFoundException({ message: 'The contact did not exist at that time.', reason: 'not_yet_created' });
    return { at: at.toISOString(), ...snap.core, customFields: snap.custom };
  }

  /** Returns the contact if it exists and the caller may see its database; otherwise 404. */
  async find(auth: AuthContext, id: string, tx: DbOrTx = this.db): Promise<Row> {
    const [row] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)));
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

  private identifiers(emails: string[], phones: string[]) {
    const r = normaliseContactIdentifiers({ emails, phones });
    if (!r.ok) {
      const messages = [...r.errors.emails, ...r.errors.phones].map((e) => e.error);
      throw new BadRequestException({ message: messages.join(' '), reason: 'invalid_identifiers', errors: r.errors });
    }
    return r;
  }

  private async checkAccount(accountId: string | null, databaseId: string): Promise<string | null> {
    if (!accountId) return null;
    const [account] = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)));
    if (!account) throw new BadRequestException({ message: 'Unknown account.', reason: 'unknown_account' });
    if (!canLinkContactToAccount(databaseId, account.databaseId)) {
      throw new BadRequestException({
        message: 'The account is in a different CRM database.',
        reason: 'account_database_mismatch',
      });
    }
    return accountId;
  }
}

export function publicContact(r: Row) {
  return {
    id: r.id,
    databaseId: r.databaseId,
    accountId: r.accountId,
    name: r.name,
    emails: r.emails,
    phones: r.phones,
    customFields: r.customFields,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
