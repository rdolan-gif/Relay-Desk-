import { z } from 'zod';
import { FILTER_OPS, PRIORITIES, TICKET_STATES } from '@relay-desk/domain';
import { layoutSchema } from '../crm/schemas';

const isoDate = z.string().datetime({ offset: true });

export const statusSchema = z.object({
  title: z.string().trim().min(1).max(100),
  color: z.string().trim().max(30).default('gray'),
  description: z.string().max(1000).optional(),
});

export const categorySchema = z.object({
  title: z.string().trim().min(1).max(200),
  groupName: z.string().trim().max(100).default(''),
  statusRequired: z.enum(['never', 'on_close', 'always']).default('never'),
  multipleStatuses: z.boolean().default(false),
  checkChildOnClose: z.boolean().default(false),
  autoArchiveDays: z.number().int().nullable().default(null),
  allowExternalComments: z.boolean().default(false),
  waitingRequiresReopen: z.boolean().default(false),
  defaultCrmDatabaseId: z.string().uuid().nullable().default(null),
  slaId: z.string().uuid().nullable().default(null),
  timeGroupId: z.string().uuid().nullable().default(null),
  retentionAction: z.enum(['none', 'anonymise', 'delete']).default('none'),
  retentionDays: z.number().int().min(1).max(3650).nullable().default(null),
  formLayout: layoutSchema.default({ sections: [] }),
  autofocusTab: z.enum(['form', 'attachments', 'templates']).default('form'),
  statusIds: z.array(z.string().uuid()).max(200).default([]),
});

const condition = z.object({
  field: z.string().max(100),
  op: z.enum(FILTER_OPS),
  value: z.union([z.string().max(500), z.number(), z.boolean()]).optional(),
});

export const viewSchema = z.object({
  name: z.string().trim().min(1).max(100),
  conditions: z.array(condition).max(20).default([]),
  columns: z.array(z.string().max(100)).max(50).nullable().default(null),
});

const ticketFields = {
  title: z.string().trim().min(1).max(500),
  description: z.string().max(200_000).optional(),
  categoryId: z.string().uuid(),
  state: z.enum(TICKET_STATES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  userId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  statusIds: z.array(z.string().uuid()).max(20).optional(),
  parentId: z.number().int().positive().nullable().optional(),
  deadline: isoDate.nullable().optional(),
  reopenAt: isoDate.nullable().optional(),
  followerIds: z.array(z.string().uuid()).max(200).optional(),
  customFields: z.record(z.unknown()).optional(),
};

export const ticketCreateSchema = z.object(ticketFields);
export const ticketUpdateSchema = z.object(ticketFields).partial().extend({
  version: z.number().int().positive().optional(),
  /** Saved by this macro (spec 10): the macro's user wins over auto-fill on close. */
  macroId: z.string().uuid().optional(),
});

export const bulkEditSchema = z.object({
  ticketIds: z.array(z.number().int().positive()).min(1).max(5000),
  changes: z
    .object({
      categoryId: z.string().uuid().optional(),
      state: z.enum(TICKET_STATES).optional(),
      priority: z.enum(PRIORITIES).optional(),
      userId: z.string().uuid().nullable().optional(),
      statusIds: z.array(z.string().uuid()).max(20).optional(),
      reopenAt: isoDate.nullable().optional(),
    })
    .refine((c) => Object.keys(c).length > 0, 'Choose at least one change'),
});

export const mergeSchema = z.object({
  ticketIds: z.array(z.number().int().positive()).min(2).max(50),
  survivorId: z.number().int().positive(),
});

export const commentSchema = z.object({
  bodyHtml: z.string().min(1).max(200_000),
  isExternal: z.boolean().optional(),
  mentionUserIds: z.array(z.string().uuid()).max(50).optional(),
});

export const moveSchema = z.object({ targetTicketId: z.number().int().positive() });
export const childSchema = z.object({
  title: z.string().trim().min(1).max(500),
  categoryId: z.string().uuid().optional(),
  activityId: z.string().uuid().optional(),
});

export const sidebarSchema = z.object({
  items: z
    .array(
      z.object({
        viewId: z.string().uuid(),
        position: z.number().int().min(0),
        folder: z.string().trim().max(100).nullable().optional(),
        parentViewId: z.string().uuid().nullable().optional(),
      }),
    )
    .max(200),
});

export const ticketListSchema = z.object({ viewId: z.string().uuid().optional() });
