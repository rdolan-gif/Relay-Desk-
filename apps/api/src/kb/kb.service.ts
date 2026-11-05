import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { canKb, isCycle, kbFolderRights, normaliseTags, type KbVerb } from '@relay-desk/domain';
import type { AuthContext } from '../common/request-context';
import { DB, type Db, type DbOrTx } from '../db/db';
import { activities, attachments, kbArticles, kbArticleVersions, kbFolders, users } from '../db/schema';
import { StorageService } from '../storage/storage.service';
import { htmlToText, sanitizeArticle } from '../tickets/sanitize';
import { TicketsService } from '../tickets/tickets.service';

export interface ArticleInput {
  folderId: string;
  title: string;
  bodyHtml: string;
  tags: string[];
  sourceActivityId?: string | null;
}

const MAX_FILE = 20 * 1024 * 1024;

/**
 * Knowledge base (spec 15): folders with view/create/update/delete rights (inherited by
 * subfolders), articles with tags, files and a version history that can be restored.
 */
@Injectable()
export class KbService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(TicketsService) private readonly tickets: TicketsService,
  ) {}

  private async tree() {
    const rows = await this.db
      .select()
      .from(kbFolders)
      .where(isNull(kbFolders.deletedAt))
      .orderBy(asc(kbFolders.position), asc(kbFolders.title));
    return { rows, parents: new Map(rows.map((r) => [r.id, r.parentId])) };
  }

  private async need(auth: AuthContext, verb: KbVerb, folderId: string | null) {
    const { parents } = await this.tree();
    if (folderId && !parents.has(folderId))
      throw new NotFoundException({ message: 'Unknown folder.', reason: 'unknown_folder' });
    if (!canKb(verb, folderId, parents, auth.ticketRights.kb))
      throw new ForbiddenException({
        message: `You cannot ${verb === 'view' ? 'see' : verb} articles in this folder.`,
        reason: 'kb_folder_rights',
      });
  }

  /** Folder ids the user can see. */
  async visibleFolderIds(auth: AuthContext): Promise<string[]> {
    const { rows, parents } = await this.tree();
    return rows.filter((f) => canKb('view', f.id, parents, auth.ticketRights.kb)).map((f) => f.id);
  }

  // ----- folders

  async folders(auth: AuthContext) {
    const { rows, parents } = await this.tree();
    const counts = await this.db
      .select({ folderId: kbArticles.folderId, n: sql<number>`count(*)::int` })
      .from(kbArticles)
      .where(isNull(kbArticles.deletedAt))
      .groupBy(kbArticles.folderId);
    return rows
      .map((f) => ({
        ...f,
        rights: kbFolderRights(f.id, parents, auth.ticketRights.kb),
        articles: counts.find((c) => c.folderId === f.id)?.n ?? 0,
      }))
      .filter((f) => f.rights.view);
  }

  async createFolder(auth: AuthContext, input: { title: string; parentId: string | null }) {
    // Top-level folders: only people with every folder (administrators by default).
    if (!input.parentId && auth.ticketRights.kb !== 'all')
      throw new ForbiddenException({
        message: 'Only administrators can add top-level folders.',
        reason: 'kb_folder_rights',
      });
    if (input.parentId) await this.need(auth, 'create', input.parentId);
    const [row] = await this.db
      .insert(kbFolders)
      .values({ title: input.title.trim(), parentId: input.parentId })
      .returning();
    return row!;
  }

  async updateFolder(
    auth: AuthContext,
    id: string,
    input: { title: string; parentId: string | null; position?: number },
  ) {
    await this.need(auth, 'update', id);
    const { parents } = await this.tree();
    if (input.parentId !== (parents.get(id) ?? null)) {
      if (isCycle(id, input.parentId, parents))
        throw new BadRequestException({ message: 'A folder cannot go inside itself.', reason: 'folder_cycle' });
      if (input.parentId) await this.need(auth, 'create', input.parentId);
      else if (auth.ticketRights.kb !== 'all')
        throw new ForbiddenException({
          message: 'Only administrators can add top-level folders.',
          reason: 'kb_folder_rights',
        });
    }
    const [row] = await this.db
      .update(kbFolders)
      .set({
        title: input.title.trim(),
        parentId: input.parentId,
        position: input.position ?? 0,
        updatedAt: new Date(),
      })
      .where(eq(kbFolders.id, id))
      .returning();
    return row!;
  }

  async deleteFolder(auth: AuthContext, id: string) {
    await this.need(auth, 'delete', id);
    const [child] = await this.db
      .select({ id: kbFolders.id })
      .from(kbFolders)
      .where(and(eq(kbFolders.parentId, id), isNull(kbFolders.deletedAt)))
      .limit(1);
    const [art] = await this.db
      .select({ id: kbArticles.id })
      .from(kbArticles)
      .where(and(eq(kbArticles.folderId, id), isNull(kbArticles.deletedAt)))
      .limit(1);
    if (child || art) throw new BadRequestException({ message: 'Empty the folder first.', reason: 'folder_not_empty' });
    await this.db.update(kbFolders).set({ deletedAt: new Date() }).where(eq(kbFolders.id, id));
  }

  // ----- articles

  /** Articles in visible folders; a folder includes its subfolders; tag and text filters. */
  async list(auth: AuthContext, q: { folderId?: string; tag?: string; q?: string; limit?: number }) {
    const { rows, parents } = await this.tree();
    let ids = rows.filter((f) => canKb('view', f.id, parents, auth.ticketRights.kb)).map((f) => f.id);
    if (q.folderId) {
      const under = (id: string): boolean => {
        for (let x: string | null = id, g = 0; x && g < 100; g++) {
          if (x === q.folderId) return true;
          x = parents.get(x) ?? null;
        }
        return false;
      };
      ids = ids.filter(under);
    }
    if (!ids.length) return [];
    const w: SQL[] = [isNull(kbArticles.deletedAt), inArray(kbArticles.folderId, ids)];
    if (q.tag) w.push(sql`${kbArticles.tags} @> array[${q.tag.toLowerCase()}]::text[]`);
    if (q.q?.trim()) w.push(this.searchSql(q.q));
    const out = await this.db
      .select({
        id: kbArticles.id,
        folderId: kbArticles.folderId,
        title: kbArticles.title,
        tags: kbArticles.tags,
        updatedAt: kbArticles.updatedAt,
        version: kbArticles.version,
        authorName: users.name,
        bodyHtml: kbArticles.bodyHtml,
      })
      .from(kbArticles)
      .leftJoin(users, eq(users.id, kbArticles.authorId))
      .where(and(...w))
      .orderBy(desc(kbArticles.updatedAt))
      .limit(Math.min(q.limit ?? 200, 500));
    return out.map(({ bodyHtml, ...a }) => ({ ...a, snippet: htmlToText(bodyHtml).slice(0, 200) }));
  }

  /** Title match, or full-text over title, body and tags (prefix matching). */
  searchSql(term: string): SQL {
    const words = term
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 2)
      .slice(0, 8);
    const like = `%${term.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return words.length
      ? sql`(${kbArticles.title} ilike ${like} or ${kbArticles.searchVector} @@ to_tsquery('simple', ${words.map((w) => `${w}:*`).join(' & ')}) or ${kbArticles.tags} && array[${sql.join(
          words.map((w) => sql`${w}`),
          sql`, `,
        )}]::text[])`
      : sql`${kbArticles.title} ilike ${like}`;
  }

  private async find(auth: AuthContext, id: string) {
    const [a] = await this.db
      .select()
      .from(kbArticles)
      .where(and(eq(kbArticles.id, id), isNull(kbArticles.deletedAt)));
    if (!a) throw new NotFoundException();
    const { parents } = await this.tree();
    if (!canKb('view', a.folderId, parents, auth.ticketRights.kb)) throw new NotFoundException();
    return a;
  }

  async get(auth: AuthContext, id: string) {
    const a = await this.find(auth, id);
    const files = await this.db
      .select({ id: attachments.id, filename: attachments.filename, mime: attachments.mime, size: attachments.size })
      .from(attachments)
      .where(and(eq(attachments.ownerType, 'kb_article'), eq(attachments.ownerId, id)));
    const [author] = a.authorId
      ? await this.db.select({ name: users.name }).from(users).where(eq(users.id, a.authorId))
      : [];
    const [editor] = a.updatedById
      ? await this.db.select({ name: users.name }).from(users).where(eq(users.id, a.updatedById))
      : [];
    const { parents } = await this.tree();
    return {
      ...a,
      searchVector: undefined,
      files,
      authorName: author?.name ?? null,
      updatedByName: editor?.name ?? null,
      rights: kbFolderRights(a.folderId, parents, auth.ticketRights.kb),
    };
  }

  private async snapshot(tx: DbOrTx, a: typeof kbArticles.$inferSelect, userId: string) {
    await tx.insert(kbArticleVersions).values({
      articleId: a.id,
      version: a.version,
      title: a.title,
      bodyHtml: a.bodyHtml,
      tags: a.tags,
      folderId: a.folderId,
      editedById: userId,
    });
  }

  async create(auth: AuthContext, input: ArticleInput) {
    await this.need(auth, 'create', input.folderId);
    if (input.sourceActivityId) {
      const [act] = await this.db
        .select({ ticketId: activities.ticketId })
        .from(activities)
        .where(eq(activities.id, input.sourceActivityId));
      if (!act || act.ticketId === null)
        throw new BadRequestException({ message: 'Unknown activity.', reason: 'unknown_activity' });
      await this.tickets.find(auth, act.ticketId);
    }
    return this.db.transaction(async (tx) => {
      const [a] = await tx
        .insert(kbArticles)
        .values({
          folderId: input.folderId,
          title: input.title.trim(),
          bodyHtml: sanitizeArticle(input.bodyHtml),
          tags: normaliseTags(input.tags),
          authorId: auth.user.id,
          updatedById: auth.user.id,
          sourceActivityId: input.sourceActivityId ?? null,
        })
        .returning();
      await this.snapshot(tx, a!, auth.user.id);
      return { id: a!.id };
    });
  }

  async update(auth: AuthContext, id: string, input: ArticleInput) {
    const before = await this.find(auth, id);
    await this.need(auth, 'update', before.folderId);
    if (input.folderId !== before.folderId) await this.need(auth, 'create', input.folderId);
    return this.db.transaction(async (tx) => {
      const [a] = await tx
        .update(kbArticles)
        .set({
          folderId: input.folderId,
          title: input.title.trim(),
          bodyHtml: sanitizeArticle(input.bodyHtml),
          tags: normaliseTags(input.tags),
          version: before.version + 1,
          updatedById: auth.user.id,
          updatedAt: new Date(),
        })
        .where(eq(kbArticles.id, id))
        .returning();
      await this.snapshot(tx, a!, auth.user.id);
      return { id, version: a!.version };
    });
  }

  async remove(auth: AuthContext, id: string) {
    const a = await this.find(auth, id);
    await this.need(auth, 'delete', a.folderId);
    await this.db.update(kbArticles).set({ deletedAt: new Date() }).where(eq(kbArticles.id, id));
  }

  async versions(auth: AuthContext, id: string) {
    await this.find(auth, id);
    return this.db
      .select({
        version: kbArticleVersions.version,
        title: kbArticleVersions.title,
        bodyHtml: kbArticleVersions.bodyHtml,
        tags: kbArticleVersions.tags,
        createdAt: kbArticleVersions.createdAt,
        editedByName: users.name,
      })
      .from(kbArticleVersions)
      .leftJoin(users, eq(users.id, kbArticleVersions.editedById))
      .where(eq(kbArticleVersions.articleId, id))
      .orderBy(desc(kbArticleVersions.version));
  }

  /** Restoring saves the old content as a new version (nothing is lost). */
  async restore(auth: AuthContext, id: string, version: number) {
    const a = await this.find(auth, id);
    const [v] = await this.db
      .select()
      .from(kbArticleVersions)
      .where(and(eq(kbArticleVersions.articleId, id), eq(kbArticleVersions.version, version)));
    if (!v) throw new NotFoundException({ message: 'Unknown version.', reason: 'unknown_version' });
    return this.update(auth, id, { folderId: a.folderId, title: v.title, bodyHtml: v.bodyHtml, tags: v.tags });
  }

  // ----- files

  async addFile(auth: AuthContext, id: string, file: { originalname: string; mimetype: string; buffer: Buffer }) {
    const a = await this.find(auth, id);
    await this.need(auth, 'update', a.folderId);
    if (file.buffer.length > MAX_FILE)
      throw new BadRequestException({ message: 'Files are limited to 20 MB.', reason: 'file_too_large' });
    const put = await this.storage.put('kb', file.buffer, 'bin');
    const [row] = await this.db
      .insert(attachments)
      .values({
        ownerType: 'kb_article',
        ownerId: id,
        filename: file.originalname.slice(0, 255),
        mime: file.mimetype || 'application/octet-stream',
        size: put.size,
        storageKey: put.key,
        checksum: put.checksum,
        createdById: auth.user.id,
      })
      .returning();
    return { id: row!.id, filename: row!.filename, mime: row!.mime, size: row!.size, url: `/api/kb/files/${row!.id}` };
  }

  async file(auth: AuthContext, fileId: string) {
    const [f] = await this.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, fileId), eq(attachments.ownerType, 'kb_article')));
    if (!f) throw new NotFoundException();
    await this.find(auth, f.ownerId);
    return { ...f, data: await this.storage.get(f.storageKey) };
  }

  async removeFile(auth: AuthContext, fileId: string) {
    const [f] = await this.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, fileId), eq(attachments.ownerType, 'kb_article')));
    if (!f) throw new NotFoundException();
    const a = await this.find(auth, f.ownerId);
    await this.need(auth, 'update', a.folderId);
    await this.db.delete(attachments).where(eq(attachments.id, fileId));
    await this.storage.delete(f.storageKey);
  }

  async tags(auth: AuthContext) {
    const ids = await this.visibleFolderIds(auth);
    if (!ids.length) return [];
    const rows = await this.db.execute<{ tag: string; n: number }>(
      sql`select unnest(tags) as tag, count(*)::int as n from kb_articles where deleted_at is null and folder_id in (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )}) group by 1 order by 2 desc, 1 limit 200`,
    );
    return rows.rows;
  }

  /** Body of an activity, to start an article from a ticket (spec 15). */
  async draftFromActivity(auth: AuthContext, activityId: string) {
    const [act] = await this.db.select().from(activities).where(eq(activities.id, activityId));
    if (!act || act.ticketId === null) throw new NotFoundException();
    const t = await this.tickets.find(auth, act.ticketId);
    return { title: t.title, bodyHtml: sanitizeArticle(act.bodyHtml), sourceActivityId: act.id };
  }
}
