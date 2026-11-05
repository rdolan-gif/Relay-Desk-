import { normaliseMailAddress } from './addresses.js';

export interface InboundHeaders {
  from: string;
  /** Lower-cased header names. */
  headers: Record<string, string | undefined>;
}

export type InboundClass =
  | { kind: 'normal' }
  /** From one of our own mailbox addresses: a loop; dropped. */
  | { kind: 'loop' }
  /** Bounce / delivery failure notice. */
  | { kind: 'bounce' }
  /** Auto-reply, out-of-office, list or bulk mail: processed, but never auto-responded to. */
  | { kind: 'automated'; reason: string };

/**
 * Loop and bounce protection (spec 11.2 step 2): ignore mail from our own queue
 * addresses; detect bounces and auto-replies (Auto-Submitted, X-Autoreply, Precedence:
 * bulk and friends) so our auto-response is never sent to them.
 */
export function classifyInbound(mail: InboundHeaders, ourAddresses: readonly string[]): InboundClass {
  const from = normaliseMailAddress(mail.from);
  const h = (k: string) => (mail.headers[k] ?? '').toLowerCase().trim();
  if (ourAddresses.map(normaliseMailAddress).includes(from)) return { kind: 'loop' };
  const local = from.split('@')[0] ?? '';
  if (
    /^(mailer-daemon|postmaster)$/.test(local) ||
    h('content-type').includes('report-type=delivery-status') ||
    h('x-failed-recipients')
  ) {
    return { kind: 'bounce' };
  }
  const autoSubmitted = h('auto-submitted');
  if (autoSubmitted && autoSubmitted !== 'no') return { kind: 'automated', reason: `Auto-Submitted: ${autoSubmitted}` };
  for (const k of ['x-autoreply', 'x-autorespond', 'x-autoresponse']) if (h(k)) return { kind: 'automated', reason: k };
  const precedence = h('precedence');
  if (['bulk', 'junk', 'list', 'auto_reply'].includes(precedence))
    return { kind: 'automated', reason: `Precedence: ${precedence}` };
  if (h('x-auto-response-suppress').match(/\b(all|oof|autoreply)\b/))
    return { kind: 'automated', reason: 'X-Auto-Response-Suppress' };
  if (h('list-id') || h('list-unsubscribe')) return { kind: 'automated', reason: 'mailing list' };
  if (/^(no-?reply|do-?not-?reply|notifications?)$/.test(local))
    return { kind: 'automated', reason: 'no-reply sender' };
  return { kind: 'normal' };
}

/** An auto-response goes out only for normal mail, when enabled (and, if set, only for new tickets). */
export function shouldAutoRespond(args: {
  enabled: boolean;
  onlyNewTickets: boolean;
  createdNewTicket: boolean;
  inbound: InboundClass;
}): boolean {
  if (!args.enabled || args.inbound.kind !== 'normal') return false;
  return !args.onlyNewTickets || args.createdNewTicket;
}
