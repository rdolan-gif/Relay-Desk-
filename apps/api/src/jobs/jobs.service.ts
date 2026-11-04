import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type { AuthContext } from '../common/request-context';
import { DB, type Db } from '../db/db';
import { jobs } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';

type Row = typeof jobs.$inferSelect;

/** What a job handler can do while it runs. */
export interface JobContext {
  job: Row;
  /** Reports progress (throttled writes; the first and last always land). */
  progress(done: number, total?: number): Promise<void>;
  /** Stores the file the user downloads when the job finishes. */
  attach(data: Buffer, fileName: string, mime: string): Promise<void>;
}

export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown> | void>;

/**
 * Background jobs (spec 14: bulk edits above 200, imports, exports, erasure, subject access
 * exports). Jobs run in the API process one after another, with progress stored so the
 * screen can show it, and a notification when they finish (spec 13).
 */
@Injectable()
export class JobsService {
  private readonly log = new Logger('Jobs');
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  async start(
    auth: AuthContext | null,
    kind: string,
    title: string,
    payload: Record<string, unknown>,
    handler: JobHandler,
  ) {
    const [job] = await this.db
      .insert(jobs)
      .values({ kind, title, payload, createdById: auth?.user.id ?? null })
      .returning();
    this.chain = this.chain.then(() => this.run(job!, handler));
    return publicJob(job!);
  }

  /** Waits for every queued job (tests, shutdown). */
  async settle() {
    await this.chain;
  }

  private async run(job: Row, handler: JobHandler) {
    let last = 0;
    let known = job.total;
    const ctx: JobContext = {
      job,
      progress: async (done, total) => {
        if (total !== undefined) known = total;
        const now = Date.now();
        if (now - last < 500 && done !== known && done !== 0) return;
        last = now;
        await this.db
          .update(jobs)
          .set({ done, ...(total !== undefined ? { total } : {}) })
          .where(eq(jobs.id, job.id));
      },
      attach: async (data, fileName, mime) => {
        const stored = await this.storage.put('jobs', data, fileName.split('.').pop() ?? 'bin');
        await this.db.update(jobs).set({ fileKey: stored.key, fileName, fileMime: mime }).where(eq(jobs.id, job.id));
      },
    };
    await this.db.update(jobs).set({ status: 'running' }).where(eq(jobs.id, job.id));
    try {
      const result = (await handler(ctx)) ?? {};
      const [done] = await this.db
        .update(jobs)
        .set({ status: 'done', result, finishedAt: new Date() })
        .where(eq(jobs.id, job.id))
        .returning();
      await this.notifications.jobDone(job.createdById, `${job.title}: finished`, summary(done!));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`job ${job.kind} ${job.id} failed: ${message}`);
      await this.db
        .update(jobs)
        .set({ status: 'failed', error: message.slice(0, 1000), finishedAt: new Date() })
        .where(eq(jobs.id, job.id));
      await this.notifications.jobDone(job.createdById, `${job.title}: failed`, message.slice(0, 200));
    }
  }

  async list(auth: AuthContext) {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(eq(jobs.createdById, auth.user.id))
      .orderBy(desc(jobs.createdAt))
      .limit(50);
    return rows.map(publicJob);
  }

  /** The job if the caller started it (administrators can see any). */
  async get(auth: AuthContext, id: string) {
    const [row] = await this.db.select().from(jobs).where(eq(jobs.id, id));
    if (!row) throw new NotFoundException();
    if (row.createdById !== auth.user.id && auth.user.type !== 'administrator') throw new NotFoundException();
    return row;
  }

  /** Only the person who ran a job downloads its file (exports hold personal data). */
  async file(auth: AuthContext, id: string) {
    const row = await this.get(auth, id);
    if (row.createdById !== auth.user.id)
      throw new ForbiddenException({
        message: 'Only the person who ran the job can download it.',
        reason: 'not_owner',
      });
    if (!row.fileKey) throw new NotFoundException({ message: 'This job has no file.', reason: 'no_file' });
    return {
      data: await this.storage.get(row.fileKey),
      name: row.fileName ?? 'download',
      mime: row.fileMime ?? 'application/octet-stream',
    };
  }
}

function summary(j: Row) {
  return Object.entries(j.result ?? {})
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
}

export function publicJob(j: Row) {
  return {
    id: j.id,
    kind: j.kind,
    title: j.title,
    status: j.status,
    total: j.total,
    done: j.done,
    result: j.result,
    error: j.error,
    hasFile: !!j.fileKey,
    fileName: j.fileName,
    createdAt: j.createdAt.toISOString(),
    finishedAt: j.finishedAt?.toISOString() ?? null,
  };
}
