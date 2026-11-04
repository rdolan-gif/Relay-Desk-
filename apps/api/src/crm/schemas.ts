import { z } from 'zod';
import { FIELD_TYPES, FILTER_OPS, RECORD_STAGES } from '@relay-desk/domain';
import { LISTS } from './crm-common';

export const layoutSchema = z.object({
  sections: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        title: z.string().max(200),
        description: z.string().max(5000).optional(),
        collapsed: z.boolean().optional(),
        fields: z
          .array(
            z.object({
              fieldId: z.string().uuid(),
              tooltip: z.string().max(500).optional(),
              hidden: z.boolean().optional(),
              readOnly: z.boolean().optional(),
              required: z.boolean().optional(),
              rows: z.number().int().optional(),
              visibleWhen: z
                .object({ fieldId: z.string().uuid(), equals: z.union([z.string().max(500), z.number(), z.boolean()]) })
                .optional(),
            }),
          )
          .max(200),
      }),
    )
    .max(50),
});
const emptyLayout = { sections: [] };

export const customFieldSchema = z.object({
  key: z.string().max(63),
  name: z.string().trim().min(1).max(200),
  type: z.enum(FIELD_TYPES),
  options: z
    .array(z.object({ value: z.string().trim().max(200), label: z.string().trim().max(200), sort: z.number().int() }))
    .max(500)
    .default([]),
  defaultValue: z.unknown().optional(),
  confirmOptionRemoval: z.boolean().optional(),
});

export const crmDatabaseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  isDefault: z.boolean().default(false),
  contactFormLayout: layoutSchema.default(emptyLayout),
  accountFormLayout: layoutSchema.default(emptyLayout),
});

export const recordTypeSchema = z.object({
  title: z.string().trim().min(1).max(200),
  statuses: z
    .array(z.object({ key: z.string().max(63), title: z.string().trim().max(200) }))
    .max(100)
    .default([]),
  formLayout: layoutSchema.default(emptyLayout),
});

const customValues = z.record(z.unknown()).optional();
const idList = (max: number) => z.array(z.string().max(320)).max(max);

export const contactCreateSchema = z.object({
  databaseId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  emails: idList(20).default([]),
  phones: idList(20).default([]),
  accountId: z.string().uuid().nullable().optional(),
  customFields: customValues,
});
export const contactUpdateSchema = contactCreateSchema.partial();

const addressSchema = z.object({
  label: z.string().max(100).default(''),
  line1: z.string().max(200),
  line2: z.string().max(200).optional(),
  town: z.string().max(100),
  county: z.string().max(100).optional(),
  postcode: z.string().max(20).default(''),
  country: z.string().max(2).default('GB'),
  isDelivery: z.boolean().default(false),
});

export const accountCreateSchema = z.object({
  databaseId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  parentId: z.string().uuid().nullable().optional(),
  branchCode: z.string().trim().max(50).nullable().optional(),
  slaId: z.string().uuid().nullable().optional(),
  emails: idList(20).optional(),
  phones: idList(20).optional(),
  addresses: z.array(addressSchema).max(50).optional(),
  customFields: customValues,
});
export const accountUpdateSchema = accountCreateSchema.partial();

export const recordCreateSchema = z.object({
  recordTypeId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  status: z.string().max(63).nullable().optional(),
  stage: z.enum(RECORD_STAGES).optional(),
  contactId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  customFields: customValues,
});
export const recordUpdateSchema = recordCreateSchema.partial();

export const snapshotQuerySchema = z.object({ at: z.coerce.date() });

export const filterSchemeSchema = z.object({
  list: z.enum(LISTS),
  name: z.string().trim().min(1).max(100),
  conditions: z
    .array(
      z.object({
        field: z.string().max(100),
        op: z.enum(FILTER_OPS),
        value: z.union([z.string().max(500), z.number(), z.boolean()]).optional(),
      }),
    )
    .max(20),
});

export const columnsSchema = z.object({ columns: z.array(z.string().max(100)).max(50) });
export const listNameSchema = z.object({ list: z.enum(LISTS) });

export const duplicateCheckSchema = z.object({
  emails: z.array(z.string().max(320)).max(20).default([]),
  phones: z.array(z.string().max(50)).max(20).default([]),
  excludeId: z.string().uuid().optional(),
});
