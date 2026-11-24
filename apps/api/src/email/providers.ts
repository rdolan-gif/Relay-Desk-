/** A message fetched from a mailbox. */
export interface FetchedMessage {
  providerId: string;
  threadId?: string;
  raw: Buffer;
}

export interface MailboxRef {
  id: string;
  address: string;
  provider: 'gmail' | 'fake';
  credentials: Record<string, string> | null;
  cursor: string | null;
}

export interface FetchResult {
  messages: FetchedMessage[];
  cursor: string | null;
}

export interface SendResult {
  providerId: string;
  threadId?: string;
  /** The Message-ID the provider actually used, if it changed it. */
  messageId?: string;
}

export interface FetchOptions {
  /** Of these provider ids, the ones already imported (so they aren't downloaded again). */
  known?: (ids: string[]) => Promise<Set<string>>;
  /** Most messages to download in one poll; the rest wait for the next poll. */
  max?: number;
}

/** One way of reading and sending mail for a mailbox (Gmail API, or a stand-in for tests). */
export interface MailProvider {
  fetchNew(box: MailboxRef, opts?: FetchOptions): Promise<FetchResult>;
  send(box: MailboxRef, raw: Buffer, opts: { threadId?: string }): Promise<SendResult>;
  /** Archives whole conversations: takes them out of the inbox, like Gmail's Archive button. */
  archiveThreads(box: MailboxRef, threadIds: string[]): Promise<void>;
}

export const MAIL_PROVIDERS = Symbol('MAIL_PROVIDERS');
export type MailProviders = Record<MailboxRef['provider'], MailProvider>;

/**
 * In-memory mailbox for tests and local demos. `deliver` puts a message in a mailbox's
 * inbox; `sent` lists what was sent from each mailbox.
 */
export class FakeMailProvider implements MailProvider {
  private inbox = new Map<string, FetchedMessage[]>();
  readonly sent = new Map<string, Buffer[]>();
  /** Conversations archived per mailbox address. */
  readonly archived = new Map<string, string[]>();
  failNextArchive: string | null = null;
  private counter = 0;
  failNextSend: string | null = null;

  deliver(address: string, raw: Buffer | string, threadId?: string) {
    const list = this.inbox.get(address.toLowerCase()) ?? [];
    list.push({ providerId: `fake-${++this.counter}`, threadId, raw: Buffer.isBuffer(raw) ? raw : Buffer.from(raw) });
    this.inbox.set(address.toLowerCase(), list);
  }

  async fetchNew(box: MailboxRef): Promise<FetchResult> {
    const all = this.inbox.get(box.address) ?? [];
    const from = box.cursor ? Number(box.cursor) : 0;
    return { messages: all.slice(from), cursor: String(all.length) };
  }

  async send(box: MailboxRef, raw: Buffer): Promise<SendResult> {
    if (this.failNextSend) {
      const msg = this.failNextSend;
      this.failNextSend = null;
      throw new Error(msg);
    }
    const list = this.sent.get(box.address) ?? [];
    list.push(raw);
    this.sent.set(box.address, list);
    return { providerId: `fake-sent-${++this.counter}` };
  }

  async archiveThreads(box: MailboxRef, threadIds: string[]): Promise<void> {
    if (this.failNextArchive) {
      const msg = this.failNextArchive;
      this.failNextArchive = null;
      throw new Error(msg);
    }
    this.archived.set(box.address, [...(this.archived.get(box.address) ?? []), ...threadIds]);
  }

  reset() {
    this.inbox.clear();
    this.sent.clear();
    this.archived.clear();
    this.failNextArchive = null;
  }
}
