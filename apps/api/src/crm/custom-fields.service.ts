import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  diffFields,
  layoutPlacements,
  removedOptionValues,
  validateFieldDefinition,
  type CustomFieldDef,
  type FieldOption,
  type FieldType,
} from '@relay-desk/domain';
import { AuditService } from '../audit/audit.service';
import { isUniqueViolation } from '../common/db-errors';
import type { AuthContext } from '../common/request-context';
import { DB, type Db } from '../db/db';
import { accounts, contacts, crmDatabases, crmRecordTypes, crmRecords, customFields } from '../db/schema';
import { formError } from './form-errors';

export interface CustomFieldInput {
  key: string;
  name: string;
  type: FieldType;
  options: FieldOption[];
  defaultValue: unknown;
  /** Required when the change removes options that stored records still use (spec 7.3). */
  confirmOptionRemoval?: boolean;
}

type Row = typeof customFields.$inferSelect;

export function toDef(r: Row): CustomFieldDef {
  return { id: r.id, key: r.key, name: r.name, type: r.type, options: r.options, defaultValue: r.defaultValue ?? null };
}

@Injectable()
export class CustomFieldsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(): Promise<CustomFieldDef[]> {
    const rows = await this.db
      .select()
      .from(customFields)
      .where(isNull(customFields.deletedAt))
      .orderBy(customFields.name);
    return rows.map(toDef);
  }

  /** All non-deleted fields keyed by id, for form validation. */
  async map(): Promise<Map<string, CustomFieldDef>> {
    return new Map((await this.list()).map((f) => [f.id, f]));
  }

  async get(id: string): Promise<CustomFieldDef> {
    return toDef(await this.find(id));
  }

  async create(auth: AuthContext, input: CustomFieldInput, ip: string | null) {
    const check = validateFieldDefinition(input);
    if (!check.ok) throw formError(check.errors, 'invalid_field');
    return this.db
      .transaction(async (tx) => {
        const [row] = await tx
          .insert(customFields)
          .values({
            key: input.key,
            name: input.name.trim(),
            type: input.type,
            options: input.options,
            defaultValue: input.defaultValue ?? null,
          })
          .returning();
        const def = toDef(row!);
        await this.audit.record(
          {
            eventType: 'settings.created',
            actorUserId: auth.user.id,
            ip,
            targetType: 'custom_field',
            targetId: def.id,
            changes: diffFields({}, { ...def }),
          },
          tx,
        );
        return def;
      })
      .catch(duplicateKey);
  }

  async update(auth: AuthContext, id: string, input: CustomFieldInput, ip: string | null) {
    const before = toDef(await this.find(id));
    const check = validateFieldDefinition(input, before);
    if (!check.ok) throw formError(check.errors, 'invalid_field');
    const removed = removedOptionValues(before.options, input.options);
    if (removed.length && !input.confirmOptionRemoval) {
      const usage = await this.optionUsage(before, removed);
      if (usage.total > 0) {
        throw new ConflictException({
          message: `${usage.total} record(s) use the removed option(s). Their values will no longer show. Confirm to continue.`,
          reason: 'options_in_use',
          usage,
        });
      }
    }
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(customFields)
        .set({
          name: input.name.trim(),
          options: input.options,
          defaultValue: input.defaultValue ?? null,
          updatedAt: new Date(),
        })
        .where(eq(customFields.id, id))
        .returning();
      const after = toDef(row!);
      await this.audit.record(
        {
          eventType: 'settings.updated',
          actorUserId: auth.user.id,
          ip,
          targetType: 'custom_field',
          targetId: id,
          changes: diffFields({ ...before }, { ...after }),
        },
        tx,
      );
      return after;
    });
  }

  /** How many stored values use the given options, per entity (spec 7.3 warning). */
  async optionUsage(def: CustomFieldDef, values: string[]) {
    const count = async (table: typeof contacts | typeof accounts | typeof crmRecords) => {
      if (values.length === 0) return 0;
      const col = table.customFields;
      const cond =
        def.type === 'multiselect'
          ? sql`coalesce((${col} -> ${def.id}) ?| array[${sql.join(
              values.map((v) => sql`${v}`),
              sql`, `,
            )}]::text[], false)`
          : sql`(${col} ->> ${def.id}) in ${values}`;
      const [r] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(and(isNull(table.deletedAt), cond));
      return r?.n ?? 0;
    };
    const usage = {
      contacts: await count(contacts),
      accounts: await count(accounts),
      records: await count(crmRecords),
    };
    return { ...usage, total: usage.contacts + usage.accounts + usage.records, values };
  }

  async remove(auth: AuthContext, id: string, ip: string | null) {
    const def = toDef(await this.find(id));
    const forms = await this.formsUsing(id);
    if (forms.length) {
      throw new ConflictException({
        message: `Remove this field from these forms first: ${forms.join(', ')}.`,
        reason: 'field_in_use',
        forms,
      });
    }
    await this.db.transaction(async (tx) => {
      await tx.update(customFields).set({ deletedAt: new Date() }).where(eq(customFields.id, id));
      await this.audit.record(
        {
          eventType: 'settings.deleted',
          actorUserId: auth.user.id,
          ip,
          targetType: 'custom_field',
          targetId: id,
          details: { key: def.key },
        },
        tx,
      );
    });
  }

  private async formsUsing(id: string): Promise<string[]> {
    const uses = (layout: { sections: { fields: { fieldId: string }[] }[] }) =>
      layoutPlacements(layout as never).some((p) => p.fieldId === id);
    const out: string[] = [];
    for (const d of await this.db.select().from(crmDatabases).where(isNull(crmDatabases.deletedAt))) {
      if (uses(d.contactFormLayout)) out.push(`${d.title} (contact form)`);
      if (uses(d.accountFormLayout)) out.push(`${d.title} (account form)`);
    }
    for (const t of await this.db.select().from(crmRecordTypes).where(isNull(crmRecordTypes.deletedAt))) {
      if (uses(t.formLayout)) out.push(`${t.title} (record form)`);
    }
    return out;
  }

  private async find(id: string): Promise<Row> {
    const [row] = await this.db
      .select()
      .from(customFields)
      .where(and(eq(customFields.id, id), isNull(customFields.deletedAt)));
    if (!row) throw new NotFoundException();
    return row;
  }
}

function duplicateKey(err: unknown): never {
  if (isUniqueViolation(err))
    throw new ConflictException({ message: 'A field with this key already exists.', reason: 'duplicate_key' });
  throw err;
}
