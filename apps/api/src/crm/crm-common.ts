import { BadRequestException } from '@nestjs/common';
import { and, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  applyFormInput,
  canSeeCrmDatabase,
  filterKindForFieldType,
  validateConditions,
  type CustomFieldDef,
  type CustomValues,
  type FilterCondition,
  type FilterFieldDef,
  type FormLayout,
  type IdScope,
} from '@relay-desk/domain';
import type { AuthContext } from '../common/request-context';
import type { Db } from '../db/db';
import { contacts, users } from '../db/schema';
import { conditionToSql, type FilterTarget } from './filter-sql';
import { formError } from './form-errors';

export const LISTS = ['contacts', 'accounts', 'records'] as const;
export type ListName = (typeof LISTS)[number];

export const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  /** JSON-encoded FilterCondition[] */
  filter: z.string().max(10_000).optional(),
  sort: z.string().max(100).optional(),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

const conditionSchema = z.array(
  z.object({
    field: z.string().max(100),
    op: z.string().max(20),
    value: z.union([z.string().max(500), z.number(), z.boolean()]).optional(),
  }),
);

/** System filter fields for each list; custom fields are appended as `custom.<id>`. */
export const SYSTEM_FILTER_FIELDS: Record<ListName, FilterFieldDef[]> = {
  contacts: [
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'emails', label: 'Email', kind: 'email_list' },
    { key: 'phones', label: 'Phone', kind: 'phone_list' },
    { key: 'accountId', label: 'Account', kind: 'ref' },
    { key: 'databaseId', label: 'CRM database', kind: 'ref' },
    { key: 'createdAt', label: 'Created', kind: 'datetime' },
    { key: 'updatedAt', label: 'Updated', kind: 'datetime' },
  ],
  accounts: [
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'databaseId', label: 'CRM database', kind: 'ref' },
    { key: 'createdAt', label: 'Created', kind: 'datetime' },
    { key: 'updatedAt', label: 'Updated', kind: 'datetime' },
  ],
  records: [
    { key: 'title', label: 'Title', kind: 'text' },
    { key: 'recordTypeId', label: 'Record type', kind: 'ref' },
    { key: 'status', label: 'Status', kind: 'option' },
    { key: 'stage', label: 'Stage', kind: 'option' },
    { key: 'userId', label: 'Owner', kind: 'ref' },
    { key: 'contactId', label: 'Contact', kind: 'ref' },
    { key: 'accountId', label: 'Account', kind: 'ref' },
    { key: 'createdAt', label: 'Created', kind: 'datetime' },
    { key: 'updatedAt', label: 'Updated', kind: 'datetime' },
  ],
};

export function filterFields(list: ListName, custom: Iterable<CustomFieldDef>): FilterFieldDef[] {
  return [
    ...SYSTEM_FILTER_FIELDS[list],
    ...[...custom].map((f) => ({ key: `custom.${f.id}`, label: f.name, kind: filterKindForFieldType(f.type) })),
  ];
}

/**
 * Parses and validates the `filter` query parameter, then turns each condition into SQL
 * using the list's column map. Custom field conditions read the JSONB column.
 */
export function filterSql(
  raw: string | undefined,
  fields: FilterFieldDef[],
  columns: Record<string, SQL>,
  customColumn: SQL,
): SQL[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException({ message: 'filter must be JSON.', reason: 'invalid_filter' });
  }
  const shape = conditionSchema.safeParse(parsed);
  if (!shape.success)
    throw new BadRequestException({ message: 'filter has the wrong shape.', reason: 'invalid_filter' });
  const check = validateConditions(fields, shape.data as FilterCondition[]);
  if (!check.ok)
    throw new BadRequestException({ message: check.errors.join(' '), reason: 'invalid_filter', errors: check.errors });
  const kinds = new Map(fields.map((f) => [f.key, f.kind]));
  return check.conditions.map((c) => {
    const kind = kinds.get(c.field)!;
    const target: FilterTarget = c.field.startsWith('custom.')
      ? { source: 'json', column: customColumn, fieldId: c.field.slice(7), kind }
      : { source: 'column', expr: columns[c.field]!, kind };
    return conditionToSql(target, c);
  });
}

export function scopeSql(column: SQL | Parameters<typeof inArray>[0], scope: IdScope): SQL | undefined {
  if (scope.all) return undefined;
  if (scope.ids.length === 0) return sql`false`;
  return inArray(column as Parameters<typeof inArray>[0], [...scope.ids]);
}

export function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/** Applies custom-form input through the layout and checks user/contact references. */
export async function applyCustomInput(args: {
  db: Db;
  auth: AuthContext;
  layout: FormLayout;
  fields: Map<string, CustomFieldDef>;
  current: CustomValues;
  input: Record<string, unknown> | undefined;
  isCreate: boolean;
}): Promise<CustomValues> {
  const r = applyFormInput({ ...args, input: args.input ?? {} });
  if (!r.ok) throw formError(r.errors);
  const userIds: string[] = [];
  const contactIds: string[] = [];
  for (const fieldId of Object.keys(args.input ?? {})) {
    const def = args.fields.get(fieldId);
    const v = r.values[fieldId];
    if (!def || typeof v !== 'string') continue;
    if (def.type === 'user') userIds.push(v);
    if (def.type === 'contact') contactIds.push(v);
  }
  if (userIds.length) {
    const found = await args.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, userIds), isNull(users.deletedAt)));
    if (found.length !== new Set(userIds).size) throw formError(['A selected user does not exist.']);
  }
  if (contactIds.length) {
    const found = await args.db
      .select({ id: contacts.id, databaseId: contacts.databaseId })
      .from(contacts)
      .where(and(inArray(contacts.id, contactIds), isNull(contacts.deletedAt)));
    if (
      found.length !== new Set(contactIds).size ||
      found.some((c) => !canSeeCrmDatabase(args.auth.rights, c.databaseId))
    ) {
      throw formError(['A selected contact does not exist.']);
    }
  }
  return r.values;
}

export function pageOf<T>(items: T[], total: number, q: ListQuery) {
  return { items, total, page: q.page, pageSize: q.pageSize };
}
