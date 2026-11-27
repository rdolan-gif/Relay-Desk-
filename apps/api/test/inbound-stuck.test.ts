import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InboundService, isOutageError } from '../src/email/inbound.service';
import { FakeMailProvider } from '../src/email/providers';
import { createPool } from '../src/db/db';
import { TEST_DATABASE_URL, createTestContext, type TestContext } from './helpers';
import { rawMail, SUPPORT } from './mail-helpers';

async function titles(): Promise<string[]> {
  const pool = createPool(TEST_DATABASE_URL);
  try {
    return (await pool.query(`select title from tickets where title like 'Stuck %' order by title`)).rows.map(
      (r) => r.title as string,
    );
  } finally {
    await pool.end();
  }
}

describe('a mailbox never gets stuck on one email', () => {
  let ctx: TestContext;
  let fake: FakeMailProvider;
  let inbound: InboundService;
  let mailbox: string;
  beforeEach(async () => {
    ctx = await createTestContext();
    fake = ctx.app.get(FakeMailProvider);
    fake.reset();
    inbound = ctx.app.get(InboundService);
    mailbox = ctx.ids.helpdesk.mailbox;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await ctx.close();
  });

  it('when one email fails with an unexpected error, it is logged as failed and the emails after it still arrive', async () => {
    fake.deliver(SUPPORT, await rawMail({ from: 'a@example.com', subject: 'Stuck 1' }));
    fake.deliver(SUPPORT, await rawMail({ from: 'b@example.com', subject: 'Stuck 2' }));
    const spy = vi.spyOn(inbound as unknown as { subjectMatch: () => Promise<unknown> }, 'subjectMatch');
    spy.mockRejectedValueOnce(new TypeError("Cannot read properties of undefined (reading 'x')"));
    const out = await inbound.syncMailbox(mailbox);
    expect(out.map((o) => o.outcome)).toEqual(['failed', 'created']);
    expect(await titles()).toEqual(['Stuck 2']);
    const log = await inbound.recentLog(mailbox);
    expect(log.some((l) => l.outcome === 'failed' && /Cannot read properties/.test(l.detail ?? ''))).toBe(true);
  });

  it('when the database is unreachable, the batch is retried on the next check and nothing is lost', async () => {
    fake.deliver(SUPPORT, await rawMail({ from: 'a@example.com', subject: 'Stuck 3' }));
    fake.deliver(SUPPORT, await rawMail({ from: 'b@example.com', subject: 'Stuck 4' }));
    const spy = vi.spyOn(inbound as unknown as { subjectMatch: () => Promise<unknown> }, 'subjectMatch');
    spy.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    await expect(inbound.syncMailbox(mailbox)).rejects.toThrow(/ECONNREFUSED/);
    await inbound.syncMailbox(mailbox);
    expect(await titles()).toEqual(['Stuck 3', 'Stuck 4']);
  });

  it('only outages (connection, resources, disk) count as "retry later"', () => {
    expect(isOutageError(Object.assign(new Error('x'), { code: '08006' }))).toBe(true);
    expect(isOutageError(Object.assign(new Error('x'), { code: '40001' }))).toBe(true);
    expect(isOutageError(new Error('wrapped', { cause: Object.assign(new Error('x'), { code: 'ENOSPC' }) }))).toBe(
      true,
    );
    expect(isOutageError(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isOutageError(Object.assign(new Error('x'), { code: '22021' }))).toBe(false);
    expect(isOutageError(Object.assign(new Error('x'), { code: '23505' }))).toBe(false);
    expect(isOutageError(new TypeError('boom'))).toBe(false);
  });
});
