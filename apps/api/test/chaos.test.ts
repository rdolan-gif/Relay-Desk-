// Chaos tests before go-live (fake mail only). Not part of Ryan's suite.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InboundService } from '../src/email/inbound.service';
import { FakeMailProvider } from '../src/email/providers';
import { createPool } from '../src/db/db';
import { TEST_DATABASE_URL, createTestContext, loginAs, type Client, type TestContext } from './helpers';
import { rawMail, receive, sentCount, SUPPORT } from './mail-helpers';

async function q(text: string, params: unknown[] = []) {
  const pool = createPool(TEST_DATABASE_URL);
  try {
    return (await pool.query(text, params)).rows;
  } finally {
    await pool.end();
  }
}
const ticketCount = async () => Number((await q('select count(*)::int as n from tickets'))[0].n);

describe('chaos', () => {
  let ctx: TestContext;
  let agent: Client;
  let admin: Client;
  let mailbox: string;
  let fake: FakeMailProvider;
  let inbound: InboundService;
  beforeEach(async () => {
    ctx = await createTestContext();
    fake = ctx.app.get(FakeMailProvider);
    fake.reset();
    inbound = ctx.app.get(InboundService);
    agent = await loginAs(ctx.app, 'agent@relaydesk.local');
    admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    mailbox = ctx.ids.helpdesk.mailbox;
  });
  afterEach(async () => {
    await ctx.close();
  });

  it('flood: 300 emails in one sync become exactly 300 tickets', async () => {
    const before = await ticketCount();
    for (let i = 0; i < 300; i++)
      fake.deliver(SUPPORT, await rawMail({ from: `c${i}@example.com`, subject: `Flood ${i}` }));
    const t0 = Date.now();
    const out = await inbound.syncMailbox(mailbox);
    console.log(`flood: 300 mails synced in ${Date.now() - t0} ms`);
    expect(out.filter((o) => o.outcome !== 'duplicate')).toHaveLength(300);
    expect((await ticketCount()) - before).toBe(300);
  }, 120_000);

  it('two syncs of the same inbox at once (overlapping poll / restart) do not double-import', async () => {
    const before = await ticketCount();
    for (let i = 0; i < 40; i++)
      fake.deliver(SUPPORT, await rawMail({ from: `p${i}@example.com`, subject: `Par ${i}` }));
    const results = await Promise.allSettled([inbound.syncMailbox(mailbox), inbound.syncMailbox(mailbox)]);
    console.log(
      'parallel sync:',
      results.map((r) => r.status + (r.status === 'rejected' ? ' ' + String(r.reason) : '')),
    );
    expect((await ticketCount()) - before).toBe(40);
  }, 60_000);

  const nasty: [string, Buffer | string][] = [
    ['empty', ''],
    ['random bytes', Buffer.from(Array.from({ length: 5000 }, () => Math.floor(Math.random() * 256)))],
    ['no From, no Subject', 'To: support@relaydesk.local\r\n\r\nbody only'],
    ['From with no address', 'From: "Just a name"\r\nTo: support@relaydesk.local\r\nSubject: x\r\n\r\nhi'],
    ['huge subject', `From: a@example.com\r\nTo: ${SUPPORT}\r\nSubject: ${'S'.repeat(20000)}\r\n\r\nhi`],
    ['null bytes', `From: a@example.com\r\nTo: ${SUPPORT}\r\nSubject: nul\u0000here\r\n\r\nbo\u0000dy`],
    [
      'bad charset',
      `From: a@example.com\r\nTo: ${SUPPORT}\r\nSubject: =?x-unknown?B?w6k=?=\r\nContent-Type: text/plain; charset=x-made-up\r\n\r\n\xe9\xe9`,
    ],
    [
      'broken multipart',
      `From: a@example.com\r\nTo: ${SUPPORT}\r\nSubject: mp\r\nContent-Type: multipart/mixed; boundary="zzz"\r\n\r\n--zzz\r\nContent-Type: text/plain\r\n\r\nno end boundary`,
    ],
    [
      'script html',
      `From: a@example.com\r\nTo: ${SUPPORT}\r\nSubject: xss\r\nContent-Type: text/html\r\n\r\n<img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">x</a>`,
    ],
    [
      'emoji/RTL',
      `From: =?UTF-8?B?8J+YgCDigK4=?= <a@example.com>\r\nTo: ${SUPPORT}\r\nSubject: =?UTF-8?B?8J+UpSDYp9mE2LnYsdio2YrYqQ==?=\r\n\r\nhi`,
    ],
  ];

  it('broken / nasty emails never block the inbox: a good email after them still arrives', async () => {
    const before = await ticketCount();
    for (const [, raw] of nasty) fake.deliver(SUPPORT, raw);
    fake.deliver(SUPPORT, await rawMail({ from: 'good@example.com', subject: 'Good after nasty' }));
    let err: unknown = null;
    try {
      const out = await inbound.syncMailbox(mailbox);
      console.log(
        'nasty outcomes:',
        out.map((o) => o.outcome),
      );
    } catch (e) {
      err = e;
      console.log('nasty: sync threw:', String(e).slice(0, 300));
    }
    // Next poll must get past it too.
    try {
      await inbound.syncMailbox(mailbox);
    } catch (e) {
      console.log('nasty: second sync threw:', String(e).slice(0, 300));
    }
    const good = await q(`select id from tickets where title = 'Good after nasty'`);
    console.log(
      `nasty: tickets created ${(await ticketCount()) - before}, good arrived: ${good.length === 1}, first error: ${err ? 'yes' : 'no'}`,
    );
    expect(good).toHaveLength(1);
    const xss = await q(
      `select a.body_html from activities a join email_messages e on e.activity_id = a.id where e.subject = 'xss'`,
    );
    expect(xss).toHaveLength(1);
    expect(String(xss[0].body_html)).not.toMatch(/<script|onerror|javascript:/i);
  }, 60_000);

  it('each nasty email alone is imported, not thrown', async () => {
    for (const [name, raw] of nasty) {
      fake.reset();
      await q('update mailbox_queues set sync_cursor = null where id = $1', [mailbox]);
      fake.deliver(SUPPORT, raw);
      const out = await inbound.syncMailbox(mailbox);
      expect(out.map((o) => `${name}: ${o.outcome}`)).toEqual([`${name}: created`]);
    }
  }, 60_000);

  it('a 20 MB attachment', async () => {
    const big = 'A'.repeat(20 * 1024 * 1024);
    const t0 = Date.now();
    const r = await receive(ctx.app, mailbox, {
      from: 'big@example.com',
      subject: 'Big file',
      attachments: [{ filename: 'big.txt', content: big }],
    }).catch((e) => ({ outcome: 'THREW ' + String(e).slice(0, 200) }));
    console.log(`20MB attachment: ${JSON.stringify(r)} in ${Date.now() - t0} ms`);
    expect((r as { outcome: string }).outcome).not.toMatch(/THREW/);
  }, 120_000);

  it('auto-reply storm: an auto-responder replying to us does not loop', async () => {
    const first = await receive(ctx.app, mailbox, { from: 'ooo@example.com', subject: 'Question' });
    const sentBefore = sentCount(ctx.app);
    for (let i = 0; i < 20; i++)
      await receive(ctx.app, mailbox, {
        from: 'ooo@example.com',
        subject: 'Out of office: Question',
        headers: { 'Auto-Submitted': 'auto-replied' },
      });
    const sentAfter = sentCount(ctx.app);
    console.log(`auto-reply storm: first=${JSON.stringify(first)} sent before=${sentBefore} after=${sentAfter}`);
    expect(sentAfter - sentBefore).toBe(0);
  });

  it('a mailbox whose Gmail login is revoked does not stop the other inboxes', async () => {
    const box2 = await admin.post('/api/settings/mailboxes', {
      title: 'Second inbox',
      address: 'second@relaydesk.local',
      provider: 'fake',
      defaultCategoryId: ctx.ids.helpdesk.categories.support,
    });
    expect(box2.status).toBe(201);
    const orig = fake.fetchNew.bind(fake);
    fake.fetchNew = async (box) => {
      if (box.address === SUPPORT) throw new Error('invalid_grant: Token has been expired or revoked.');
      return orig(box);
    };
    fake.deliver(
      'second@relaydesk.local',
      await rawMail({ from: 'x@example.com', to: 'second@relaydesk.local', subject: 'Still works' }),
    );
    await inbound.syncAll();
    const err = await q('select last_error from mailbox_queues where id = $1', [mailbox]);
    console.log('revoked: last_error =', err[0]?.last_error);
    const boxes = (await admin.get('/api/settings/mailboxes')).body;
    console.log(
      'revoked: admin sees',
      JSON.stringify(boxes)
        .match(/invalid_grant|lastError[^,]*/g)
        ?.slice(0, 3),
    );
    expect(await q(`select id from tickets where title = 'Still works'`)).toHaveLength(1);
  });

  it('send failure: Gmail refuses a reply → it is marked failed, not lost silently', async () => {
    const first = await receive(ctx.app, mailbox, { from: 'cust@example.com', subject: 'Need help' });
    const tid = (first as { ticketId: number }).ticketId;
    const acts = (await agent.get(`/api/tickets/${tid}/activities`)).body;
    fake.failNextSend = '503 Gmail is temporarily unavailable';
    const res = await agent.post('/api/emails', {
      queueId: mailbox,
      ticketId: tid,
      kind: 'reply',
      replyToActivityId: acts[0].id,
      to: ['cust@example.com'],
      subject: 'Re: Need help',
      bodyHtml: '<p>answer</p>',
    });
    const after = (await agent.get(`/api/tickets/${tid}/activities`)).body as { id: string; status?: string }[];
    console.log(
      'send failure: http',
      res.status,
      'statuses',
      after.map((a) => a.status),
    );
    expect(res.status).toBeLessThan(500);
    expect(after.some((a) => a.status === 'failed' || a.status === 'queued' || a.status === 'retrying')).toBe(true);
  });

  it('two agents saving the same ticket at the same moment: one wins, the other gets a clear conflict', async () => {
    const r = await receive(ctx.app, mailbox, { from: 'race@example.com', subject: 'Race' });
    const tid = (r as { ticketId: number }).ticketId;
    const t = (await agent.get(`/api/tickets/${tid}`)).body;
    const res = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        (i % 2 ? admin : agent).patch(`/api/tickets/${tid}`, { version: t.version, title: `Race edit ${i}` }),
      ),
    );
    const codes = res.map((x) => x.status);
    console.log('race codes:', codes.join(','));
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.every((c) => c === 200 || c === 409)).toBe(true);
  });

  it('database connections killed mid-flood: next poll finishes the job with no duplicates', async () => {
    const before = await ticketCount();
    for (let i = 0; i < 200; i++)
      fake.deliver(SUPPORT, await rawMail({ from: `k${i}@example.com`, subject: `Kill ${i}` }));
    const sync = inbound.syncMailbox(mailbox).catch((e) => `threw: ${String(e).slice(0, 120)}`);
    await new Promise((r) => setTimeout(r, 400));
    await q(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()`,
    );
    console.log('kill: first sync ->', typeof (await sync) === 'string' ? await sync : 'completed');
    const mid = (await ticketCount()) - before;
    let second: unknown = 'ok';
    try {
      await inbound.syncMailbox(mailbox);
    } catch (e) {
      second = String(e).slice(0, 120);
    }
    const end = (await ticketCount()) - before;
    console.log(`kill: after kill ${mid} tickets, after next poll ${end} (second sync: ${second})`);
    expect(end).toBe(200);
    // The app still answers after its connections were cut.
    expect((await agent.get('/api/tickets?q=Kill')).status).toBe(200);
  }, 120_000);
});
