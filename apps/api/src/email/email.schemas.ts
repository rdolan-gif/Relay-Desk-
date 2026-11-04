import { z } from 'zod';
import { PRIORITIES, ROUTING_FIELDS, ROUTING_OPS, TICKET_STATES } from '@relay-desk/domain';

export const mailboxSchema = z.object({
  title: z.string().trim().min(1).max(200),
  address: z.string().trim().email().max(320),
  senderName: z.string().trim().max(200).default(''),
  provider: z.enum(['gmail', 'fake']).default('gmail'),
  defaultCategoryId: z.string().uuid(),
  headerThreading: z.boolean().default(true),
  active: z.boolean().default(true),
  autoResponseEnabled: z.boolean().default(false),
  autoResponseNewOnly: z.boolean().default(true),
  autoResponseTemplateId: z.string().uuid().nullable().default(null),
  defaultBodyTemplateId: z.string().uuid().nullable().default(null),
  crmDatabaseIds: z.array(z.string().uuid()).max(50).default([]),
});

const condition = z.object({
  field: z.enum(ROUTING_FIELDS),
  op: z.enum(ROUTING_OPS),
  value: z.string().max(500).optional(),
  fieldId: z.string().max(100).optional(),
  negate: z.boolean().optional(),
});

export const routingRuleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  direction: z.enum(['incoming', 'outgoing', 'both']).default('incoming'),
  active: z.boolean().default(true),
  all: z.array(condition).max(30).default([]),
  any: z.array(condition).max(30).default([]),
  actions: z
    .object({
      categoryId: z.string().uuid().optional(),
      userId: z.string().uuid().nullable().optional(),
      statusIds: z.array(z.string().uuid()).max(20).optional(),
      state: z.enum(TICKET_STATES).optional(),
      priority: z.enum(PRIORITIES).optional(),
      customFields: z.record(z.unknown()).optional(),
    })
    .default({}),
});
export const reorderSchema = z.object({ ids: z.array(z.string().uuid()).max(500) });

export const templateSchema = z.object({
  kind: z.enum(['reply', 'auto_response', 'default_body']).default('reply'),
  title: z.string().trim().min(1).max(200),
  subject: z.string().max(500).nullable().optional(),
  bodyHtml: z.string().max(200_000).default(''),
  queueIds: z.array(z.string().uuid()).max(100).default([]),
  categoryIds: z.array(z.string().uuid()).max(500).default([]),
});
export const renderSchema = z.object({ ticketId: z.number().int().positive().nullable().default(null) });

const emails = z.array(z.string().max(320)).max(50);
export const sendSchema = z.object({
  queueId: z.string().uuid(),
  ticketId: z.number().int().positive().nullable().optional(),
  kind: z.enum(['reply', 'reply_all', 'forward', 'new']).default('reply'),
  replyToActivityId: z.string().uuid().nullable().optional(),
  to: emails.min(1),
  cc: emails.default([]),
  bcc: emails.default([]),
  subject: z.string().trim().min(1).max(500),
  bodyHtml: z.string().max(500_000),
  attachmentIds: z.array(z.string().uuid()).max(50).default([]),
});
export const listTemplatesSchema = z.object({
  kind: z.enum(['reply', 'auto_response', 'default_body']).optional(),
  queueId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
});
