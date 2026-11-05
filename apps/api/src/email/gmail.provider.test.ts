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
});
