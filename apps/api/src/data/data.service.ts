import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import {
  importAction,
  mapRow,
  normaliseEmailAddress,
  normalisePhone,
  toCsv,
  validateMapping,
  type DuplicateMode,
  type ImportEntity,
  type ImportMapping,
  type MatchOn,
} from '@relay-desk/domain';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/request-context';
import { AccountsService } from '../crm/accounts.service';
import { ContactsService } from '../crm/contacts.service';
import type { ListQuery } from '../crm/crm-common';
import { CustomFieldsService } from '../crm/custom-fields.service';
import { DB, type Db } from '../db/db';
import { accounts, activities, attachments, contacts, emailMessages, importTemplates, ticketStatuses, users } from '../db/schema';
import { JobsService } from '../jobs/jobs.service';
import { StorageService } from '../storage/storage.service';
import { TicketsService } from '../tickets/tickets.service';
import { readTable, ukDateTime, writeTable, type FileFormat } from './spreadsheet';

export type ExportEntity = 'contacts' | 'accounts' | 'tickets';
type Item = Record<string, unknown> & { customFields?: Record<string, unknown> };
interface Col {
  key: string;
  label: string;
  value: (r: Item) => unknown;
}

const MAX_EXPORT_ROWS = 50_000;
const MAX_IMPORT_ROWS = 20_000;

/** Import and export (spec 12.4, 14). Every export runs through the same list and rights as the screen. */
@Injectable()
export class DataService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(TicketsService) private readonly tickets: TicketsService,
    @Inject(CustomFieldsService) private readonly fields: CustomFieldsService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ export

  private async columns(entity: ExportEntity, tz: string): Promise<Col[]> {
    const date = (k: string) => (r: Item) => ukDateTime(r[k], tz);
    const base: Record<ExportEntity, Col[]> = {
      contacts: [
        { key: 'name', label: 'Name', value: (r) => r.name },
        { key: 'emails', label: 'Emails', value: (r) => r.emails },
        { key: 'phones', label: 'Phones', value: (r) => r.phones },
        { key: 'accountName', label: 'Account', value: (r) => r.accountName },
        { key: 'databaseTitle', label: 'CRM database', value: (r) => r.databaseTitle },
        { key: 'createdAt', label: 'Created', value: date('createdAt') },
        { key: 'updatedAt', label: 'Updated', value: date('updatedAt') },
      ],
      accounts: [
        { key: 'path', label: 'Account', value: (r) => r.path ?? r.name },
        { key: 'name', label: 'Name', value: (r) => r.name },
        { key: 'branchCode', label: 'Branch number', value: (r) => r.branchCode },
        { key: 'emails', label: 'Emails', value: (r) => r.emails },
        { key: 'phones', label: 'Phones', value: (r) => r.phones },
        { key: 'createdAt', label: 'Created', value: date('createdAt') },
      ],
      tickets: [],
    };
    if (entity === 'tickets') {
      const statuses = await this.db.select({ id: ticketStatuses.id, title: ticketStatuses.title }).from(ticketStatuses);
      base.tickets = [
        { key: 'id', label: 'ID', value: (r) => r.id },
        { key: 'title', label: 'Title', value: (r) => r.title },
        { key: 'contactName', label: 'Contact', value: (r) => r.contactName },
        { key: 'categoryTitle', label: 'Category', value: (r) => r.categoryTitle },
        { key: 'state', label: 'State', value: (r) => r.state },
        { key: 'statusIds', label: 'Status', value: (r) => (r.statusIds as string[]).map((s) => statuses.find((x) => x.id === s)?.title ?? s) },
        { key: 'priority', label: 'Priority', value: (r) => r.priority },
        { key: 'userName', label: 'User', value: (r) => r.userName },
        { key: 'deadline', label: 'Deadline', value: date('deadline') },
        { key: 'lastActivityAt', label: 'Last activity', value: date('lastActivityAt') },
        { key: 'createdAt', label: 'Created', value: date('createdAt') },
      ];
    }
    const custom: Col[] = (await this.fields.list()).map((f) => ({
      key: `custom.${f.id}`,
      label: f.name,
      value: (r: Item) => {
        const v = r.customFields?.[f.id];
        const label = (x: unknown) => f.options.find((o) => o.value === x)?.label ?? x;
        return Array.isArray(v) ? v.map(label) : v === undefined || v === null ? '' : label(v);
      },
    }));
    return [...base[entity], ...custom];
  }

  private async rows(auth: AuthContext, entity: ExportEntity, q: ListQuery, extra: unknown[] = []): Promise<Item[]> {
    const out: Item[] = [];
    for (let page = 1; out.length < MAX_EXPORT_ROWS; page++) {
      const query = { ...q, page, pageSize: 200 };
      const res =
        entity === 'contacts'
          ? await this.contacts.list(auth, query)
          : entity === 'accounts'
            ? await this.accounts.list(auth, query)
            : await this.tickets.list(auth, query, extra as never);
      out.push(...(res.items as unknown as Item[]));
      if (res.items.length < 200) break;
    }
    return out;
  }

  /** The current filtered list with the chosen columns (spec 12.4, 14). */
  async export(auth: AuthContext, entity: ExportEntity, q: ListQuery, columns: string[], format: FileFormat, ip: string | null, extra: unknown[] = []) {
    const [me] = await this.db.select({ tz: users.timezone }).from(users).where(eq(users.id, auth.user.id));
    const all = await this.columns(entity, me?.tz ?? 'Europe/London');
    const chosen = columns.length ? columns.map((k) => all.find((c) => c.key === k)).filter((c): c is Col => !!c) : all.slice(0, 8);
    if (!chosen.length) throw new BadRequestException({ message: 'Choose at least one column.', reason: 'no_columns' });
    const items = await this.rows(auth, entity, q, extra);
    const file = await writeTable([chosen.map((c) => c.label), ...items.map((r) => chosen.map((c) => c.value(r)))], format, entity);
    await this.audit.record({
      eventType: 'export.run',
      actorUserId: auth.user.id,
      ip,
      targetType: entity,
      details: { rows: items.length, columns: chosen.map((c) => c.key), format },
    });
    return { ...file, name: `${entity}-${new Date().toISOString().slice(0, 10)}.${file.ext}`, rows: items.length };
  }

  /** Every email of the filtered tickets as .eml files in a ZIP (spec 14 [SHOULD]). */
  async exportTicketEmails(auth: AuthContext, q: ListQuery, ip: string | null, extra: unknown[] = []) {
    const items = await this.rows(auth, 'tickets', q, extra);
    await this.audit.record({ eventType: 'export.run', actorUserId: auth.user.id, ip, targetType: 'tickets', details: { rows: items.length, emails: true } });
    return this.jobs.start(auth, 'export_ticket_emails', 'Ticket emails (ZIP)', { tickets: items.length }, async (ctx) => {
      const files: Record<string, Uint8Array> = {};
      let n = 0;
      await ctx.progress(0, items.length);
      for (const t of items) {
        const mails = await this.db
          .select({ id: emailMessages.activityId, key: emailMessages.rawStorageKey, subject: emailMessages.subject })
          .from(emailMessages)
          .innerJoin(activities, eq(activities.id, emailMessages.activityId))
          .where(and(eq(activities.ticketId, t.id as number), isNull(activities.deletedAt)))
          .orderBy(asc(activities.createdAt));
        let i = 0;
        for (const m of mails) {
          if (!m.key) continue;
          const data = await this.storage.get(m.key).catch(() => null);
          if (data) files[`${t.id}/${String(++i).padStart(3, '0')}-${m.id.slice(0, 8)}.eml`] = new Uint8Array(data);
        }
        await ctx.progress(++n);
      }
      if (!Object.keys(files).length) files['README.txt'] = strToU8('No stored emails for these tickets.');
      await ctx.attach(Buffer.from(zipSync(files)), `ticket-emails-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip');
      return { tickets: items.length, emails: Object.keys(files).length };
    });
  }

  // ------------------------------------------------------------------ import

  async upload(auth: AuthContext, file: { originalname: string; mimetype: string; buffer: Buffer }) {
    if (!/\.(csv|xlsx)$/i.test(file.originalname))
      throw new BadRequestException({ message: 'Upload a .csv or .xlsx file.', reason: 'unsupported_file' });
    const put = await this.storage.put('imports', file.buffer, file.originalname.split('.').pop()!.toLowerCase());
    const [row] = await this.db
      .insert(attachments)
      .values({
        ownerType: 'upload',
        ownerId: auth.user.id,
        filename: file.originalname.slice(0, 255),
        mime: file.mimetype || 'application/octet-stream',
        size: put.size,
        storageKey: put.key,
        checksum: put.checksum,
        createdById: auth.user.id,
      })
      .returning();
    return this.preview(auth, row!.id);
  }

  private async table(auth: AuthContext, fileId: string) {
    const [f] = await this.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, fileId), eq(attachments.ownerType, 'upload'), eq(attachments.ownerId, auth.user.id)));
    if (!f) throw new NotFoundException({ message: 'Upload the file again.', reason: 'unknown_file' });
    const rows = await readTable(await this.storage.get(f.storageKey), f.filename).catch(() => {
      throw new BadRequestException({ message: 'The file could not be read.', reason: 'unreadable_file' });
    });
    if (!rows.length) throw new BadRequestException({ message: 'The file is empty.', reason: 'empty_file' });
    const headers = rows[0]!.map((h, i) => h.trim() || `Column ${i + 1}`);
    return { file: f, headers, rows: rows.slice(1) };
  }

  /** Headers, the first 20 rows and the row count, for mapping (spec 12.4). */
  async preview(auth: AuthContext, fileId: string) {
    const t = await this.table(auth, fileId);
    return { fileId, filename: t.file.filename, headers: t.headers, rows: t.rows.slice(0, 20), total: t.rows.length };
  }

  async runImport(
    auth: AuthContext,
    input: { fileId: string; entity: ImportEntity; databaseId: string; mapping: ImportMapping; duplicate: DuplicateMode; matchOn: MatchOn },
    ip: string | null,
  ) {
    const errors = validateMapping(input.entity, input.mapping);
    if (errors.length) throw new BadRequestException({ message: errors.join(' '), reason: 'invalid_mapping' });
    const t = await this.table(auth, input.fileId);
    if (t.rows.length > MAX_IMPORT_ROWS)
      throw new BadRequestException({ message: `Import at most ${MAX_IMPORT_ROWS} rows at a time.`, reason: 'too_many_rows' });
    const fieldByKey = new Map((await this.fields.list()).map((f) => [f.key, f.id]));
    await this.audit.record({
      eventType: 'import.run',
      actorUserId: auth.user.id,
      ip,
      targetType: input.entity,
      details: { file: t.file.filename, rows: t.rows.length, duplicate: input.duplicate, matchOn: input.matchOn },
    });
    const label = input.entity === 'contacts' ? 'Contact import' : 'Account import';
    return this.jobs.start(auth, `import_${input.entity}`, `${label}: ${t.file.filename}`, { rows: t.rows.length }, async (ctx) => {
      const report: unknown[][] = [['Line', 'Name', 'Problem']];
      const counts = { created: 0, updated: 0, skipped: 0, failed: 0 };
      await ctx.progress(0, t.rows.length);
      for (let i = 0; i < t.rows.length; i++) {
        const r = mapRow(t.headers, t.rows[i]!, input.mapping, i + 2);
        try {
          if (!r.name) throw new Error('No name.');
          const customFields: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(r.custom)) {
            const id = fieldByKey.get(k);
            if (id) customFields[id] = v;
          }
          const emails = r.emails.map((e) => normaliseEmailAddress(e)).flatMap((x) => (x.ok ? [x.value] : []));
          const phones = r.phones.map((p) => normalisePhone(p)).flatMap((x) => (x.ok ? [x.value] : []));
          const keys = input.matchOn === 'email' ? emails : phones;
          const table = input.entity === 'contacts' ? contacts : accounts;
          const col = input.matchOn === 'email' ? table.emails : table.phones;
          const matches = keys.length
            ? await this.db
                .select({ id: table.id })
                .from(table)
                .where(and(eq(table.databaseId, input.databaseId), isNull(table.deletedAt), sql`${col} && array[${sql.join(keys.map((k) => sql`${k}`), sql`, `)}]::text[]`))
            : [];
          const action = importAction(matches.length, input.duplicate);
          if (action === 'skip') {
            counts.skipped++;
            report.push([r.line, r.name, 'Skipped: already exists']);
          } else if (input.entity === 'contacts') {
            const accountId = r.parent ? await this.accountFor(auth, input.databaseId, r.parent) : undefined;
            const body = { name: r.name, emails: r.emails, phones: r.phones, ...(accountId !== undefined ? { accountId } : {}), customFields };
            if (action === 'update') await this.contacts.update(auth, matches[0]!.id, body);
            else await this.contacts.create(auth, { databaseId: input.databaseId, ...body });
            counts[action === 'update' ? 'updated' : 'created']++;
          } else {
            const parentId = r.parent ? await this.companyFor(input.databaseId, r.parent) : undefined;
            const body = { name: r.name, emails: r.emails, phones: r.phones, branchCode: r.branchCode, ...(parentId !== undefined ? { parentId } : {}), customFields };
            if (action === 'update') await this.accounts.update(auth, matches[0]!.id, body);
            else await this.accounts.create(auth, { databaseId: input.databaseId, ...body });
            counts[action === 'update' ? 'updated' : 'created']++;
          }
        } catch (err) {
          counts.failed++;
          const msg = (err as { response?: { message?: string } }).response?.message ?? (err as Error).message;
          report.push([r.line, r.name, msg]);
        }
        await ctx.progress(i + 1);
      }
      if (report.length > 1) await ctx.attach(Buffer.from(toCsv(report), 'utf8'), 'import-report.csv', 'text/csv; charset=utf-8');
      return counts;
    });
  }

  /** A contact's account by name; created when it does not exist yet. */
  private async accountFor(auth: AuthContext, databaseId: string, name: string): Promise<string> {
    const [a] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.databaseId, databaseId), isNull(accounts.deletedAt), sql`lower(${accounts.name}) = lower(${name})`))
      .limit(1);
    if (a) return a.id;
    return (await this.accounts.create(auth, { databaseId, name })).id;
  }

  /** A branch's company by name (must exist, spec: Company › Branch). */
  private async companyFor(databaseId: string, name: string): Promise<string> {
    const [a] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.databaseId, databaseId), isNull(accounts.deletedAt), isNull(accounts.parentId), sql`lower(${accounts.name}) = lower(${name})`))
      .limit(1);
    if (!a) throw new Error(`Company "${name}" not found; import the companies first.`);
    return a.id;
  }

  // ------------------------------------------------------------------ mapping templates

  listTemplates(entity: ImportEntity) {
    return this.db.select().from(importTemplates).where(eq(importTemplates.entity, entity)).orderBy(asc(importTemplates.name));
  }

  async saveTemplate(auth: AuthContext, input: { entity: ImportEntity; name: string; mapping: ImportMapping }) {
    const [row] = await this.db.insert(importTemplates).values({ ...input, createdById: auth.user.id }).returning();
    return row!;
  }

  async deleteTemplate(id: string) {
    await this.db.delete(importTemplates).where(eq(importTemplates.id, id));
  }
}
