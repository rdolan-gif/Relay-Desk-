import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import { CONFIG, type AppConfig } from '../config/config';
import { randomToken, sha256 } from '../common/crypto';
import { DB, type Db, type DbOrTx } from '../db/db';
import { sessions } from '../db/schema';

export const SESSION_COOKIE = 'rd_session';
/** Only write last_seen_at at most once per minute per session. */
const TOUCH_INTERVAL_MS = 60_000;

export type SessionRow = typeof sessions.$inferSelect;

@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async create(userId: string, ip: string | null, userAgent: string | null) {
    const token = randomToken();
    const csrfToken = randomToken();
    const expiresAt = new Date(Date.now() + this.config.SESSION_ABSOLUTE_HOURS * 3600_000);
    const [row] = await this.db
      .insert(sessions)
      .values({ tokenHash: sha256(token), csrfToken, userId, ip, userAgent, expiresAt })
      .returning();
    return { token, csrfToken, expiresAt, sessionId: row!.id };
  }

  /** Returns the live session for a cookie token, or null if missing, revoked, expired or idle. */
  async resolve(token: string, now = new Date()): Promise<SessionRow | null> {
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt)));
    if (!row) return null;
    if (row.expiresAt <= now || this.isIdle(row, now)) {
      await this.db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, row.id));
      return null;
    }
    if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.id));
    }
    return row;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
  }

  async revokeAllForUser(userId: string, tx: DbOrTx = this.db, exceptSessionId?: string): Promise<void> {
    const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
    if (exceptSessionId) conditions.push(ne(sessions.id, exceptSessionId));
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(...conditions));
  }

  /** "Logged in" = holds at least one unrevoked, unexpired, non-idle session. */
  async hasActiveSession(userId: string, tx: DbOrTx = this.db, now = new Date()): Promise<boolean> {
    const rows = await tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)));
    return rows.some((r) => !this.isIdle(r, now));
  }

  private isIdle(row: SessionRow, now: Date): boolean {
    return now.getTime() - row.lastSeenAt.getTime() > this.config.SESSION_IDLE_MINUTES * 60_000;
  }
}
