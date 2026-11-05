import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  canSeeCrmDatabase,
  canSeeRecordType,
  diffFields,
  validateLayout,
  validateRecordStatuses,
  type FormLayout,
  type RecordStatusDef,
} from '@relay-desk/domain';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/request-context';
import { DB, type Db } from '../db/db';
import { accounts, contacts, crmDatabases, crmRecordTypes, crmRecords } from '../db/schema';
import { CustomFieldsService } from './custom-fields.service';
import { formError } from './form-errors';

export interface CrmDatabaseInput {
  title: string;
  isDefault: boolean;
  contactFormLayout: FormLayout;
  accountFormLayout: FormLayout;
}

export interface RecordTypeInput {
  title: string;
  statuses: RecordStatusDef[];
  formLayout: FormLayout;
}

type DbRow = typeof crmDatabases.$inferSelect;
type TypeRow = typeof crmRecordTypes.$inferSelect;

const publicDb = (r: DbRow) => ({
  id: r.id,
  title: r.title,
  isDefault: r.isDefault,
  contactFormLayout: r.contactFormLayout,
  accountFormLayout: r.accountFormLayout,
});
const publicType = (r: TypeRow) => ({ id: r.id, title: r.title, statuses: r.statuses, formLayout: r.formLayout });

/**
 * CRM databases (spec 12.1) and record types (spec 12.2). Both are scoped by the
 * caller's rights, including on the Settings pages.
 */
@Injectable()
export class CrmSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CustomFieldsService) private readonly fields: CustomFieldsService,
  ) {}

  // ----- databases

  async listDatabases(auth: AuthContext) {
    const rows = await this.db
      .select()
      .from(crmDatabases)
      .where(isNull(crmDatabases.deletedAt))
      .orderBy(crmDatabases.title);
    return rows.filter((r) => canSeeCrmDatabase(auth.rights, r.id)).map(publicDb);
  }

  async getDatabase(auth: AuthContext, id: string) {
    return publicDb(await this.findDatabase(auth, id));
  }

  async createDatabase(auth: AuthContext, input: CrmDatabaseInput, ip: string | null) {
    if (auth.rights.crmDatabases !== 'all') {
      throw new ForbiddenException({
        message: 'Only users who can see all CRM databases may create one.',
        reason: 'scope_required',
      });
    }
    await this.checkLayouts([input.contactFormLayout, input.accountFormLayout]);
    return this.db.transaction(async (tx) => {
      const [{ n }] = (await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(crmDatabases)
        .where(isNull(crmDatabases.deletedAt))) as [{ n: number }];
      // The first database is always the default; exactly one default exists.
      const isDefault = input.isDefault || n === 0;
      if (isDefault) await tx.update(crmDatabases).set({ isDefault: false }).where(eq(crmDatabases.isDefault, true));
      const [row] = await tx
        .insert(crmDatabases)
        .values({
          title: input.title,
          isDefault,
          contactFormLayout: input.contactFormLayout,
          accountFormLayout: input.accountFormLayout,
        })
        .returning();
      const out = publicDb(row!);
      await this.audit.record(
        {
          eventType: 'settings.created',
          actorUserId: auth.user.id,
          ip,
          targetType: 'crm_database',
          targetId: out.id,
          changes: diffFields({}, out),
        },
        tx,
      );
      return out;
    });
  }

  async updateDatabase(auth: AuthContext, id: string, input: CrmDatabaseInput, ip: string | null) {
    const before = await this.findDatabase(auth, id);
    if (before.isDefault && !input.isDefault) {
      throw new ConflictException({
        message: 'Make another database the default instead.',
        reason: 'default_required',
      });
    }
    await this.checkLayouts([input.contactFormLayout, input.accountFormLayout]);
    return this.db.transaction(async (tx) => {
      if (input.isDefault && !before.isDefault) {
        await tx
          .update(crmDatabases)
          .set({ isDefault: false })
          .where(and(eq(crmDatabases.isDefault, true), ne(crmDatabases.id, id)));
      }
      const [row] = await tx
        .update(crmDatabases)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(crmDatabases.id, id))
        .returning();
      const out = publicDb(row!);
      await this.audit.record(
        {
          eventType: 'settings.updated',
          actorUserId: auth.user.id,
          ip,
          targetType: 'crm_database',
          targetId: id,
          changes: diffFields(publicDb(before), out),
        },
        tx,
      );
      return out;
    });
  }

  async deleteDatabase(auth: AuthContext, id: string, ip: string | null) {
    const before = await this.findDatabase(auth, id);
    if (before.isDefault)
      throw new ConflictException({ message: 'The default database cannot be deleted.', reason: 'default_required' });
    const used =
      (
        await this.db
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.databaseId, id), isNull(contacts.deletedAt)))
          .limit(1)
      ).length +
      (
        await this.db
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.databaseId, id), isNull(accounts.deletedAt)))
          .limit(1)
      ).length;
    if (used)
      throw new ConflictException({
        message: 'This database still has contacts or accounts.',
        reason: 'database_not_empty',
      });
    await this.db.transaction(async (tx) => {
      await tx.update(crmDatabases).set({ deletedAt: new Date() }).where(eq(crmDatabases.id, id));
      await this.audit.record(
        { eventType: 'settings.deleted', actorUserId: auth.user.id, ip, targetType: 'crm_database', targetId: id },
        tx,
      );
    });
  }

  async findDatabase(auth: AuthContext, id: string): Promise<DbRow> {
    const [row] = await this.db
      .select()
      .from(crmDatabases)
      .where(and(eq(crmDatabases.id, id), isNull(crmDatabases.deletedAt)));
    if (!row || !canSeeCrmDatabase(auth.rights, id)) throw new NotFoundException();
    return row;
  }

  // ----- record types

  async listRecordTypes(auth: AuthContext) {
    const rows = await this.db
      .select()
      .from(crmRecordTypes)
      .where(isNull(crmRecordTypes.deletedAt))
      .orderBy(crmRecordTypes.title);
    return rows.filter((r) => canSeeRecordType(auth.rights, r.id)).map(publicType);
  }

  async getRecordType(auth: AuthContext, id: string) {
    return publicType(await this.findRecordType(auth, id));
  }

  async createRecordType(auth: AuthContext, input: RecordTypeInput, ip: string | null) {
    if (auth.rights.crmRecordTypes !== 'all') {
      throw new ForbiddenException({
        message: 'Only users who can see all record types may create one.',
        reason: 'scope_required',
      });
    }
    await this.checkRecordType(input);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(crmRecordTypes).values(input).returning();
      const out = publicType(row!);
      await this.audit.record(
        {
          eventType: 'settings.created',
          actorUserId: auth.user.id,
          ip,
          targetType: 'crm_record_type',
          targetId: out.id,
          changes: diffFields({}, out),
        },
        tx,
      );
      return out;
    });
  }

  async updateRecordType(auth: AuthContext, id: string, input: RecordTypeInput, ip: string | null) {
    const before = await this.findRecordType(auth, id);
    await this.checkRecordType(input);
    const removed = before.statuses.map((s) => s.key).filter((k) => !input.statuses.some((s) => s.key === k));
    if (removed.length) {
      const [r] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(crmRecords)
        .where(
          and(eq(crmRecords.recordTypeId, id), isNull(crmRecords.deletedAt), sql`${crmRecords.status} in ${removed}`),
        );
      if ((r?.n ?? 0) > 0) {
        throw new ConflictException({
          message: `${r!.n} record(s) still use the removed status(es).`,
          reason: 'status_in_use',
          count: r!.n,
        });
      }
    }
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(crmRecordTypes)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(crmRecordTypes.id, id))
        .returning();
      const out = publicType(row!);
      await this.audit.record(
        {
          eventType: 'settings.updated',
          actorUserId: auth.user.id,
          ip,
          targetType: 'crm_record_type',
          targetId: id,
          changes: diffFields(publicType(before), out),
        },
        tx,
      );
      return out;
    });
  }

  async deleteRecordType(auth: AuthContext, id: string, ip: string | null) {
    await this.findRecordType(auth, id);
    const used = await this.db
      .select({ id: crmRecords.id })
      .from(crmRecords)
      .where(and(eq(crmRecords.recordTypeId, id), isNull(crmRecords.deletedAt)))
      .limit(1);
    if (used.length)
      throw new ConflictException({ message: 'Records of this type still exist.', reason: 'record_type_in_use' });
    await this.db.transaction(async (tx) => {
      await tx.update(crmRecordTypes).set({ deletedAt: new Date() }).where(eq(crmRecordTypes.id, id));
      await this.audit.record(
        { eventType: 'settings.deleted', actorUserId: auth.user.id, ip, targetType: 'crm_record_type', targetId: id },
        tx,
      );
    });
  }

  async findRecordType(auth: AuthContext, id: string): Promise<TypeRow> {
    const [row] = await this.db
      .select()
      .from(crmRecordTypes)
      .where(and(eq(crmRecordTypes.id, id), isNull(crmRecordTypes.deletedAt)));
    if (!row || !canSeeRecordType(auth.rights, id)) throw new NotFoundException();
    return row;
  }

  private async checkRecordType(input: RecordTypeInput) {
    const errors = validateRecordStatuses(input.statuses);
    if (errors.length) throw formError(errors, 'invalid_statuses');
    await this.checkLayouts([input.formLayout]);
  }

  private async checkLayouts(layouts: FormLayout[]) {
    const fields = await this.fields.map();
    const errors = layouts.flatMap((l) => validateLayout(l, fields));
    if (errors.length) throw formError(errors, 'invalid_layout');
  }
}
