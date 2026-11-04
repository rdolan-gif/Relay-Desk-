import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { renderTemplate, type TemplateValues } from '@relay-desk/domain';
import type { AuthContext } from '../common/request-context';
import { DB, type Db, type DbOrTx } from '../db/db';
import { accounts, contacts, customFields, emailTemplates, tickets, users } from '../db/schema';
import { sanitizeEmailHtml } from './email-html';

export interface TemplateInput {
  kind: 'reply' | 'auto_response' | 'default_body';
  title: string;
  subject?: string | null;
  bodyHtml: string;
  queueIds: string[];
  categoryIds: string[];
}

type Row = typeof emailTemplates.$inferSelect;

/**
 * Email templates written by the team (owner O-6): reply templates, auto-responses and
 * default bodies. Anyone who can work tickets can create them; only the author or a
 * Settings administrator can change or delete one.
 */
@Injectable()
export class TemplatesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(filter: { kind?: Row['kind']; queueId?: string; categoryId?: string } = {}) {
    const rows = await this.db
      .select({ t: emailTemplates, authorName: users.name })
      .from(emailTemplates)
      .leftJoin(users, eq(users.id, emailTemplates.createdById))
      .where(and(isNull(emailTemplates.deletedAt), filter.kind ? eq(emailTemplates.kind, filter.kind) : undefined))
      .orderBy(asc(emailTemplates.title));
    return rows
      .filter(({ t }) => !filter.queueId || t.queueIds.length === 0 || t.queueIds.includes(filter.queueId))
      .filter(({ t }) => !filter.categoryId || t.categoryIds.length === 0 || t.categoryIds.includes(filter.categoryId))
      .map(({ t, authorName }) => ({ ...t, authorName }));
  }

  async create(auth: AuthContext, input: TemplateInput) {
    const [row] = await this.db
      .insert(emailTemplates)
      .values({
        ...input,
        subject: input.subject ?? null,
        bodyHtml: sanitizeEmailHtml(input.bodyHtml),
        createdById: auth.user.id,
      })
      .returning();
    return row!;
  }

  async update(auth: AuthContext, id: string, input: TemplateInput) {
    const before = await this.find(id);
    this.assertCanEdit(auth, before);
    const [row] = await this.db
      .update(emailTemplates)
      .set({
        ...input,
        subject: input.subject ?? null,
        bodyHtml: sanitizeEmailHtml(input.bodyHtml),
        updatedAt: new Date(),
      })
      .where(eq(emailTemplates.id, id))
      .returning();
    return row!;
  }

  async remove(auth: AuthContext, id: string) {
    this.assertCanEdit(auth, await this.find(id));
    await this.db.update(emailTemplates).set({ deletedAt: new Date() }).where(eq(emailTemplates.id, id));
  }

  async find(id: string, tx: DbOrTx = this.db): Promise<Row> {
    const [row] = await tx
      .select()
      .from(emailTemplates)
      .where(and(eq(emailTemplates.id, id), isNull(emailTemplates.deletedAt)));
    if (!row) throw new NotFoundException({ message: 'Unknown template.', reason: 'unknown_template' });
    return row;
  }

  /** Placeholder values for a ticket: {ticket.*}, {contact.*}, {account.*}, {user.*} and custom keys. */
  async valuesFor(ticketId: number | null, userName: string, tx: DbOrTx = this.db): Promise<TemplateValues> {
    const values: TemplateValues = { 'user.name': userName };
    if (ticketId === null) return values;
    const [t] = await tx.select().from(tickets).where(eq(tickets.id, ticketId));
    if (!t) return values;
    values['ticket.id'] = t.id;
    values['ticket.title'] = t.title;
    const keyById = new Map(
      (await tx.select({ id: customFields.id, key: customFields.key }).from(customFields)).map((f) => [f.id, f.key]),
    );
    const addCustom = (custom: Record<string, unknown>) => {
      for (const [id, v] of Object.entries(custom)) {
        const key = keyById.get(id);
        if (key && (typeof v === 'string' || typeof v === 'number')) values[key] = v;
      }
    };
    addCustom(t.customFields);
    if (t.contactId) {
      const [c] = await tx.select().from(contacts).where(eq(contacts.id, t.contactId));
      if (c) {
        values['contact.name'] = c.name;
        values['contact.email'] = c.emails[0] ?? '';
        addCustom(c.customFields);
        if (c.accountId) {
          const [a] = await tx.select().from(accounts).where(eq(accounts.id, c.accountId));
          if (a) values['account.name'] = a.name;
        }
      }
    }
    return values;
  }

  async render(id: string, ticketId: number | null, userName: string, tx: DbOrTx = this.db) {
    const tpl = await this.find(id, tx);
    const values = await this.valuesFor(ticketId, userName, tx);
    return {
      subject: tpl.subject ? renderTemplate(tpl.subject, values, { html: false }) : null,
      bodyHtml: renderTemplate(tpl.bodyHtml, values),
    };
  }

  private assertCanEdit(auth: AuthContext, t: Row) {
    if (t.createdById !== auth.user.id && auth.principal.type !== 'administrator') {
      throw new ForbiddenException({
        message: 'Only the author or an administrator can change this template.',
        reason: 'not_author',
      });
    }
  }
}
