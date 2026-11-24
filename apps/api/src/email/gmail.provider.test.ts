import { describe, expect, it } from 'vitest';
import { GmailProvider } from './gmail.provider';
import type { MailboxRef } from './providers';

/** A tiny fake of the Google endpoints the provider uses. */
function fakeGoogle() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const raw = Buffer.from('From: a@b.com\r\nSubject: Hi\r\n\r\nBody').toString('base64url');
  const http = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u.includes('oauth2.googleapis.com/token')) return json({ access_token: 'at', expires_in: 3600 });
    if (u.endsWith('/profile')) return json({ historyId: '100', emailAddress: 'support@ricoman.com' });
    if (u.includes('/history?'))
      return json({
        historyId: '105',
        history: [{ messagesAdded: [{ message: { id: 'm1' } }, { message: { id: 'm2' } }] }],
      });
    if (u.includes('/messages/m1?format=raw') || u.includes('/messages/m2?format=raw'))
      return json({ id: u.includes('m1') ? 'm1' : 'm2', threadId: 't1', raw });
    if (u.endsWith('/messages/send')) return json({ id: 's1', threadId: 't1' });
    if (u.endsWith('/threads/t1/modify')) return json({ id: 't1' });
    if (u.includes('/messages/s1?format=metadata'))
      return json({ payload: { headers: [{ name: 'Message-ID', value: '<gmail-id@mail.gmail.com>' }] } });
    return json({ error: 'not found' }, 404);
  }) as typeof fetch;
  return { http, calls };
}

const box = (cursor: string | null): MailboxRef => ({
  id: 'q',
  address: 'support@ricoman.com',
  provider: 'gmail',
  credentials: { refreshToken: 'rt' },
  cursor,
});

describe('Gmail API provider (owner O-2)', () => {
  it('the first sync starts from now: it records the history id and imports nothing', async () => {
    const g = fakeGoogle();
    const p = new GmailProvider(() => ({ clientId: 'id', clientSecret: 'secret' }), g.http);
    expect(await p.fetchNew(box(null))).toEqual({ messages: [], cursor: '100' });
  });

  it('later syncs read new inbox messages from the history and advance the cursor', async () => {
    const g = fakeGoogle();
    const p = new GmailProvider(() => ({ clientId: 'id', clientSecret: 'secret' }), g.http);
    const res = await p.fetchNew(box('100'));
    expect(res.cursor).toBe('105');
    expect(res.messages.map((m) => [m.providerId, m.threadId])).toEqual([
      ['m1', 't1'],
      ['m2', 't1'],
    ]);
    expect(res.messages[0]!.raw.toString()).toContain('Subject: Hi');
    expect(g.calls.find((c) => c.url.includes('/history?'))!.url).toContain('labelId=INBOX');
    // The access token is refreshed with the stored refresh token and cached.
    expect(g.calls.filter((c) => c.url.includes('/token'))).toHaveLength(1);
  });

  it('sending posts the raw message in the thread and reads back the Message-ID Gmail stored', async () => {
    const g = fakeGoogle();
    const p = new GmailProvider(() => ({ clientId: 'id', clientSecret: 'secret' }), g.http);
    const res = await p.send(box('100'), Buffer.from('raw mime'), { threadId: 't1' });
    expect(res).toEqual({ providerId: 's1', threadId: 't1', messageId: '<gmail-id@mail.gmail.com>' });
    const body = JSON.parse(String(g.calls.find((c) => c.url.endsWith('/messages/send'))!.init!.body));
    expect(body).toEqual({ raw: Buffer.from('raw mime').toString('base64url'), threadId: 't1' });
  });

  it('a mailbox without a refresh token is reported as not connected', async () => {
    const p = new GmailProvider(() => ({ clientId: 'id', clientSecret: 'secret' }), fakeGoogle().http);
    await expect(p.fetchNew({ ...box(null), credentials: null })).rejects.toThrow(/not connected/);
  });

  it('archiving takes a whole conversation out of the inbox, and a conversation already deleted in Gmail is skipped', async () => {
    const { http, calls } = fakeGoogle();
    const p = new GmailProvider(() => ({ clientId: 'c', clientSecret: 's' }), http);
    await p.archiveThreads(box('100'), ['t1', 'gone']);
    const modify = calls.filter((c) => c.url.includes('/threads/'));
    expect(modify.map((c) => c.url.split('/users/me')[1])).toEqual(['/threads/t1/modify', '/threads/gone/modify']);
    expect(JSON.parse(String(modify[0]!.init!.body))).toEqual({ removeLabelIds: ['INBOX'] });
  });

  it('an email deleted forever in Gmail before it was read is skipped; the rest still import', async () => {
    const { http } = fakeGoogle();
    const gone = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/history?'))
        return new Response(
          JSON.stringify({
            historyId: '106',
            history: [{ messagesAdded: [{ message: { id: 'gone' } }, { message: { id: 'm1' } }] }],
          }),
          { status: 200 },
        );
      return http(url, init);
    }) as typeof fetch;
    const p = new GmailProvider(() => ({ clientId: 'c', clientSecret: 's' }), gone);
    const res = await p.fetchNew(box('100'));
    expect(res.messages.map((m) => m.providerId)).toEqual(['m1']);
    expect(res.cursor).toBe('106');
  });

  describe('catching up on a backlog', () => {
    /** History lists `n` emails (b1..bn); each download costs one call, and `quotaAfter` downloads hit Gmail's quota. */
    function backlog(n: number, quotaAfter = Infinity) {
      const { http } = fakeGoogle();
      const raw = Buffer.from('Subject: Hi\r\n\r\nBody').toString('base64url');
      let gets = 0;
      const fetcher = (async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
        if (u.includes('/history?'))
          return json({
            historyId: '200',
            history: [{ messagesAdded: Array.from({ length: n }, (_, i) => ({ message: { id: `b${i + 1}` } })) }],
          });
        const m = /\/messages\/(b\d+)\?format=raw/.exec(u);
        if (m) {
          if (++gets > quotaAfter) return json({ error: { code: 429, message: 'Quota exceeded' } }, 429);
          return json({ id: m[1], threadId: `t-${m[1]}`, raw });
        }
        return http(url, init);
      }) as typeof fetch;
      return { p: new GmailProvider(() => ({ clientId: 'c', clientSecret: 's' }), fetcher), gets: () => gets };
    }

    it('downloads at most `max` per poll and keeps the cursor so the next poll carries on', async () => {
      const b = backlog(5);
      const res = await b.p.fetchNew(box('100'), { max: 2 });
      expect(res.messages.map((m) => m.providerId)).toEqual(['b1', 'b2']);
      expect(res.cursor).toBe('100');
      expect(b.gets()).toBe(2);
    });

    it('skips emails already imported, and moves the cursor on once the rest are in', async () => {
      const b = backlog(5);
      const res = await b.p.fetchNew(box('100'), { max: 3, known: async () => new Set(['b1', 'b2']) });
      expect(res.messages.map((m) => m.providerId)).toEqual(['b3', 'b4', 'b5']);
      expect(res.cursor).toBe('200');
      expect(b.gets()).toBe(3);
    });

    it('running out of quota part way keeps what was downloaded and holds the cursor', async () => {
      const b = backlog(5, 2);
      const res = await b.p.fetchNew(box('100'), { max: 10 });
      expect(res.messages.map((m) => m.providerId)).toEqual(['b1', 'b2']);
      expect(res.cursor).toBe('100');
    });

    it('running out of quota before anything downloads is still an error', async () => {
      const b = backlog(5, 0);
      await expect(b.p.fetchNew(box('100'))).rejects.toThrow(/429/);
    });
  });
});
