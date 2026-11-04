/**
 * Automatic distribution (spec 9): unassigned mailbox tickets go to the eligible agent with
 * the fewest Open tickets in the category, up to their limit; ties go to whoever has waited
 * longest since their last assignment. Otherwise tickets wait in a FIFO backlog.
 */
export interface DistributionCandidate {
  userId: string;
  /** Active, non-external user. */
  active: boolean;
  /** Rights include the category with Access = Yes. */
  categoryAccess: boolean;
  /** Distribution limit on that category link; null = no auto-distribution. */
  limit: number | null;
  /** The category is the default category of a mailbox queue in their rights… */
  queueInRights: boolean;
  /** …and they are logged in to that queue ("Ready for email"). */
  loggedIn: boolean;
  /** Their Open tickets in the category (Waiting, Closed and Archived don't count). */
  openCount: number;
  lastAssignedAt: Date | null;
}

export function isEligible(c: DistributionCandidate): boolean {
  return (
    c.active &&
    c.categoryAccess &&
    c.limit !== null &&
    c.limit > 0 &&
    c.queueInRights &&
    c.loggedIn &&
    c.openCount < c.limit
  );
}

export function pickAgent(candidates: DistributionCandidate[]): string | null {
  const best = candidates
    .filter(isEligible)
    .sort(
      (a, b) =>
        a.openCount - b.openCount ||
        (a.lastAssignedAt?.getTime() ?? -Infinity) - (b.lastAssignedAt?.getTime() ?? -Infinity) ||
        a.userId.localeCompare(b.userId),
    )[0];
  return best?.userId ?? null;
}

/**
 * Assigns backlog tickets (oldest first) one at a time, counting each assignment against
 * the agent's limit. Tickets nobody can take stay in the backlog.
 */
export function planDistribution(
  backlog: number[],
  candidates: DistributionCandidate[],
  now: Date,
): { ticketId: number; userId: string }[] {
  const pool = candidates.map((c) => ({ ...c }));
  const out: { ticketId: number; userId: string }[] = [];
  for (const ticketId of backlog) {
    const userId = pickAgent(pool);
    if (!userId) break;
    const c = pool.find((p) => p.userId === userId)!;
    c.openCount += 1;
    c.lastAssignedAt = now;
    out.push({ ticketId, userId });
  }
  return out;
}
