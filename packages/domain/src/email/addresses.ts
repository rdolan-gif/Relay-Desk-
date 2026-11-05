/** A parsed email address. */
export interface MailAddress {
  name?: string;
  address: string;
}

export const normaliseMailAddress = (a: string) => a.trim().toLowerCase();

export function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at < 0 ? '' : address.slice(at + 1).toLowerCase();
}

/** Strip angle brackets and whitespace from a Message-ID-like header value. */
export function cleanMessageId(id: string): string {
  return id.trim().replace(/^<|>$/g, '').trim();
}

/** Splits a References header (space/newline separated ids) into clean ids. */
export function parseReferences(header: string | undefined | null): string[] {
  if (!header) return [];
  return (header.match(/<[^>]+>|[^\s<>]+@[^\s<>]+/g) ?? []).map(cleanMessageId).filter(Boolean);
}

/** The ticket reference token placed in outgoing subjects, e.g. "[#1234]". */
export const subjectToken = (ticketId: number) => `[#${ticketId}]`;

/** Ticket number from a "[#1234]" token in a subject, if any. */
export function ticketIdFromSubject(subject: string | undefined | null): number | null {
  const m = (subject ?? '').match(/\[#(\d{1,9})\]/);
  return m ? Number(m[1]) : null;
}

/** "Re: Re: Fwd: Hello [#12]" -> "Hello" (for ticket titles and reply subjects). */
export function baseSubject(subject: string | undefined | null): string {
  let s = (subject ?? '').replace(/\[#\d{1,9}\]/g, '').trim();
  for (let i = 0; i < 10; i++) {
    const next = s.replace(/^(re|fw|fwd|aw|sv|antw)\s*(\[\d+\])?\s*:\s*/i, '').trim();
    if (next === s) break;
    s = next;
  }
  return s || '(no subject)';
}

/** Subject for an outgoing reply or forward, always carrying the ticket token. */
export function replySubject(kind: 'reply' | 'forward' | 'new', original: string | null, ticketId: number): string {
  const base = baseSubject(original);
  const prefix = kind === 'reply' ? 'Re: ' : kind === 'forward' ? 'Fwd: ' : '';
  return `${prefix}${base} ${subjectToken(ticketId)}`;
}

/**
 * Reply all (spec 11.4): the original sender plus original To/Cc, minus our own
 * addresses and duplicates. Reply = the sender only (or Reply-To when present).
 */
export function replyRecipients(args: {
  kind: 'reply' | 'reply_all';
  from: MailAddress[];
  replyTo?: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  ourAddresses: readonly string[];
}): { to: string[]; cc: string[] } {
  const ours = new Set(args.ourAddresses.map(normaliseMailAddress));
  const seen = new Set<string>();
  const pick = (list: MailAddress[]) =>
    list
      .map((a) => normaliseMailAddress(a.address))
      .filter((a) => a && !ours.has(a) && !seen.has(a) && (seen.add(a), true));
  const to = pick(args.replyTo?.length ? args.replyTo : args.from);
  if (args.kind === 'reply') return { to, cc: [] };
  const cc = pick([...args.to, ...args.cc]);
  return { to, cc };
}
