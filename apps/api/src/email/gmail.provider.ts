import type { FetchResult, MailProvider, MailboxRef, SendResult } from './providers';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export type Fetcher = typeof fetch;

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

/**
 * Gmail through the free Gmail API (owner O-2). Reads new inbox mail with the history
 * API (cursor = historyId) and sends with messages.send. Uses only `fetch`; no SDK.
 */
export class GmailProvider implements MailProvider {
  private tokens = new Map<string, { token: string; expires: number }>();

  constructor(
    private readonly client: () => GoogleClient,
    private readonly http: Fetcher = fetch,
  ) {}

  async fetchNew(box: MailboxRef): Promise<FetchResult> {
    const token = await this.accessToken(box);
    if (!box.cursor) {
      // First sync: start from now, so connecting doesn't import the whole mailbox.
      const profile = await this.json<{ historyId: string }>(`${API}/profile`, token);
      return { messages: [], cursor: profile.historyId };
    }
    const ids: string[] = [];
    let cursor = box.cursor;
    let pageToken: string | undefined;
    try {
      do {
        const q = new URLSearchParams({ startHistoryId: box.cursor, historyTypes: 'messageAdded', labelId: 'INBOX' });
        if (pageToken) q.set('pageToken', pageToken);
        const page = await this.json<{
          history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[];
          historyId: string;
          nextPageToken?: string;
        }>(`${API}/history?${q}`, token);
        for (const h of page.history ?? [])
          for (const m of h.messagesAdded ?? []) if (!ids.includes(m.message.id)) ids.push(m.message.id);
        cursor = page.historyId;
        pageToken = page.nextPageToken;
      } while (pageToken);
    } catch (err) {
      // An expired history id (404): fall back to the last day of inbox mail; the
      // inbound log de-duplicates anything already processed.
      if (!(err instanceof GmailError) || err.status !== 404) throw err;
      const list = await this.json<{ messages?: { id: string }[] }>(
        `${API}/messages?${new URLSearchParams({ q: 'in:inbox newer_than:1d', maxResults: '200' })}`,
        token,
      );
      ids.push(...(list.messages ?? []).map((m) => m.id));
      cursor = (await this.json<{ historyId: string }>(`${API}/profile`, token)).historyId;
    }
    const messages = [];
    for (const id of ids) {
      const m = await this.json<{ id: string; threadId: string; raw: string }>(
        `${API}/messages/${id}?format=raw`,
        token,
      );
      messages.push({ providerId: m.id, threadId: m.threadId, raw: Buffer.from(m.raw, 'base64url') });
    }
    return { messages, cursor };
  }

  async send(box: MailboxRef, raw: Buffer, opts: { threadId?: string }): Promise<SendResult> {
    const token = await this.accessToken(box);
    const sent = await this.json<{ id: string; threadId: string }>(`${API}/messages/send`, token, {
      method: 'POST',
      body: JSON.stringify({ raw: raw.toString('base64url'), ...(opts.threadId ? { threadId: opts.threadId } : {}) }),
    });
    // Read back the Message-ID Gmail stored, so customers' replies thread to the ticket.
    const meta = await this.json<{ payload?: { headers?: { name: string; value: string }[] } }>(
      `${API}/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`,
      token,
    );
    const messageId = meta.payload?.headers?.find((h) => h.name.toLowerCase() === 'message-id')?.value;
    return { providerId: sent.id, threadId: sent.threadId, messageId };
  }

  private async accessToken(box: MailboxRef): Promise<string> {
    const cached = this.tokens.get(box.id);
    if (cached && cached.expires > Date.now() + 60_000) return cached.token;
    const refreshToken = box.credentials?.refreshToken;
    if (!refreshToken) throw new GmailError(401, 'This mailbox is not connected to Google yet.');
    const { clientId, clientSecret } = this.client();
    const res = await this.http(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !body.access_token)
      throw new GmailError(
        res.status,
        `Google refused the mailbox credentials (${body.error ?? res.status}). Reconnect the mailbox.`,
      );
    this.tokens.set(box.id, { token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 });
    return body.access_token;
  }

  private async json<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
    const res = await this.http(url, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new GmailError(res.status, `Gmail API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }
}

export class GmailError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
