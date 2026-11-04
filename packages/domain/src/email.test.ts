import { describe, expect, it } from 'vitest';
import { baseSubject, parseReferences, replyRecipients, replySubject, ticketIdFromSubject } from './email/addresses.js';
import { classifyInbound, shouldAutoRespond } from './email/automated.js';
import { decideThread, pickContact } from './email/threading.js';
import {
  applyRoutingRules,
  conditionMatches,
  validateRule,
  type RoutingInput,
  type RoutingRule,
} from './email/routing.js';
import { placeholdersIn, renderTemplate, signatureHtml } from './email/templates.js';

const d = (h: number) => new Date(Date.UTC(2026, 10, 4, h));

describe('threading (spec 11.2)', () => {
  it('a reply with a changed subject threads by its headers to the right ticket', () => {
    expect(
      decideThread({
        headerThreading: true,
        headerMatches: [{ ticketId: 7, state: 'waiting', lastActivityAt: d(9) }],
        subjectMatch: null,
      }),
    ).toEqual({
      action: 'append',
      ticketId: 7,
      suggested: [],
    });
  });
  it('a reply to an Archived ticket creates a new ticket', () => {
    expect(
      decideThread({
        headerThreading: true,
        headerMatches: [{ ticketId: 7, state: 'archived', lastActivityAt: d(9) }],
        subjectMatch: null,
      }),
    ).toEqual({
      action: 'new_ticket',
      suggested: [],
    });
  });
  it('several matches: append to the most recent and suggest the rest', () => {
    const r = decideThread({
      headerThreading: true,
      headerMatches: [
        { ticketId: 1, state: 'open', lastActivityAt: d(8) },
        { ticketId: 2, state: 'closed', lastActivityAt: d(10) },
        { ticketId: 3, state: 'open', lastActivityAt: d(9) },
      ],
      subjectMatch: null,
    });
    expect(r).toEqual({ action: 'append', ticketId: 2, suggested: [3, 1] });
  });
  it('the subject token is the fallback when headers do not match, or header threading is off', () => {
    const sub = { ticketId: 9, state: 'open' as const, lastActivityAt: d(9) };
    expect(decideThread({ headerThreading: true, headerMatches: [], subjectMatch: sub })).toMatchObject({
      action: 'append',
      ticketId: 9,
    });
    expect(
      decideThread({
        headerThreading: false,
        headerMatches: [{ ticketId: 7, state: 'open', lastActivityAt: d(9) }],
        subjectMatch: sub,
      }),
    ).toMatchObject({
      action: 'append',
      ticketId: 9,
    });
  });
  it('no match at all creates a new ticket', () => {
    expect(decideThread({ headerThreading: true, headerMatches: [], subjectMatch: null })).toEqual({
      action: 'new_ticket',
      suggested: [],
    });
  });
  it('contact matching picks the most recently active of several', () => {
    const a = { id: 'a', updatedAt: d(8) };
    const b = { id: 'b', updatedAt: d(10) };
    expect(pickContact([a, b])).toEqual({ contact: b, others: [a] });
    expect(pickContact([])).toEqual({ contact: null, others: [] });
  });
});

describe('headers and subjects (spec 11.2, 11.4)', () => {
  it('references are parsed into clean message ids', () => {
    expect(parseReferences('<a@x.com>\n <b@y.com> c@z.com')).toEqual(['a@x.com', 'b@y.com', 'c@z.com']);
  });
  it('the [#123] token is read from subjects, and reply subjects carry it', () => {
    expect(ticketIdFromSubject('Re: Order query [#123]')).toBe(123);
    expect(ticketIdFromSubject('No token')).toBeNull();
    expect(replySubject('reply', 'Re: RE: Fwd: Order query [#123]', 123)).toBe('Re: Order query [#123]');
    expect(replySubject('forward', 'Order query', 5)).toBe('Fwd: Order query [#5]');
    expect(baseSubject('  ')).toBe('(no subject)');
  });
  it('Reply all includes original recipients minus our own addresses; Reply uses Reply-To when present', () => {
    const args = {
      from: [{ address: 'Dana@Customer.example' }],
      to: [{ address: 'support@ricoman.com' }, { address: 'buyer@customer.example' }],
      cc: [{ address: 'dana@customer.example' }, { address: 'ops@customer.example' }],
      ourAddresses: ['support@ricoman.com'],
    };
    expect(replyRecipients({ ...args, kind: 'reply_all' })).toEqual({
      to: ['dana@customer.example'],
      cc: ['buyer@customer.example', 'ops@customer.example'],
    });
    expect(replyRecipients({ ...args, kind: 'reply', replyTo: [{ address: 'orders@customer.example' }] })).toEqual({
      to: ['orders@customer.example'],
      cc: [],
    });
  });
});

describe('loops, bounces and auto-replies (spec 11.2 step 2)', () => {
  const ours = ['support@ricoman.com'];
  it('mail from our own address is a loop', () => {
    expect(classifyInbound({ from: 'Support@Ricoman.com', headers: {} }, ours)).toEqual({ kind: 'loop' });
  });
  it('bounces are detected', () => {
    expect(classifyInbound({ from: 'MAILER-DAEMON@google.com', headers: {} }, ours).kind).toBe('bounce');
  });
  it('auto-replies are detected by Auto-Submitted, X-Autoreply and Precedence', () => {
    expect(classifyInbound({ from: 'a@b.com', headers: { 'auto-submitted': 'auto-replied' } }, ours).kind).toBe(
      'automated',
    );
    expect(classifyInbound({ from: 'a@b.com', headers: { 'x-autoreply': 'yes' } }, ours).kind).toBe('automated');
    expect(classifyInbound({ from: 'a@b.com', headers: { precedence: 'bulk' } }, ours).kind).toBe('automated');
    expect(classifyInbound({ from: 'a@b.com', headers: { 'auto-submitted': 'no' } }, ours).kind).toBe('normal');
  });
  it('an auto-reply never triggers our auto-response', () => {
    const automated = classifyInbound({ from: 'a@b.com', headers: { 'auto-submitted': 'auto-replied' } }, ours);
    expect(
      shouldAutoRespond({ enabled: true, onlyNewTickets: false, createdNewTicket: true, inbound: automated }),
    ).toBe(false);
    expect(
      shouldAutoRespond({ enabled: true, onlyNewTickets: false, createdNewTicket: true, inbound: { kind: 'normal' } }),
    ).toBe(true);
  });
  it('auto-responses respect "only for new tickets" and the on/off switch', () => {
    expect(
      shouldAutoRespond({ enabled: true, onlyNewTickets: true, createdNewTicket: false, inbound: { kind: 'normal' } }),
    ).toBe(false);
    expect(
      shouldAutoRespond({ enabled: false, onlyNewTickets: false, createdNewTicket: true, inbound: { kind: 'normal' } }),
    ).toBe(false);
  });
});

describe('routing rules (spec 11.3, owner S-3)', () => {
  const input: RoutingInput = {
    direction: 'incoming',
    from: 'noreply@supplier.example',
    to: ['support@ricoman.com'],
    cc: [],
    subject: 'Purchase Order PO-5512 for 40 panels',
    body: 'Please find attached our PO.',
    queueId: 'q1',
    hasAttachment: true,
    contactFields: { tier: 'gold' },
    accountFields: {},
  };
  const rule = (id: string, extra: Partial<RoutingRule>): RoutingRule => ({
    id,
    title: id,
    direction: 'incoming',
    active: true,
    all: [],
    any: [],
    actions: {},
    ...extra,
  });

  it('conditions compare case-insensitively with equals, contains, starts/ends with, regex and empty', () => {
    expect(conditionMatches({ field: 'from', op: 'contains', value: 'NOREPLY' }, input)).toBe(true);
    expect(conditionMatches({ field: 'from_domain', op: 'equals', value: 'supplier.example' }, input)).toBe(true);
    expect(conditionMatches({ field: 'subject', op: 'starts_with', value: 'purchase' }, input)).toBe(true);
    expect(conditionMatches({ field: 'subject', op: 'ends_with', value: 'panels' }, input)).toBe(true);
    expect(conditionMatches({ field: 'subject', op: 'regex', value: '\\bPO-?\\d+' }, input)).toBe(true);
    expect(conditionMatches({ field: 'cc', op: 'is_empty' }, input)).toBe(true);
    expect(conditionMatches({ field: 'contact_field', fieldId: 'tier', op: 'equals', value: 'gold' }, input)).toBe(
      true,
    );
    expect(conditionMatches({ field: 'has_attachment', op: 'equals', value: 'true' }, input)).toBe(true);
    expect(conditionMatches({ field: 'subject', op: 'regex', value: '(' }, input)).toBe(false);
  });
  it('"all of these" and "any of these" groups combine', () => {
    expect(
      rule('r', {
        all: [{ field: 'subject', op: 'contains', value: 'order' }],
        any: [{ field: 'body', op: 'contains', value: 'nope' }],
      }),
    ).toBeTruthy();
    const r = applyRoutingRules(
      [
        rule('a', {
          all: [{ field: 'subject', op: 'contains', value: 'order' }],
          any: [{ field: 'body', op: 'contains', value: 'nope' }],
          actions: { priority: 'low' },
        }),
        rule('b', {
          all: [{ field: 'subject', op: 'contains', value: 'order' }],
          any: [{ field: 'body', op: 'contains', value: 'attached' }],
          actions: { priority: 'high' },
        }),
      ],
      input,
    );
    expect(r).toEqual({ actions: { priority: 'high' }, matchedRuleIds: ['b'] });
  });
  it('every matching rule applies in order; later rules win for the same field; custom values accumulate', () => {
    const r = applyRoutingRules(
      [
        rule('noreply', {
          all: [{ field: 'from', op: 'contains', value: 'noreply' }],
          actions: { categoryId: 'do-not-reply', priority: 'low' },
        }),
        rule('po', {
          any: [{ field: 'subject', op: 'regex', value: 'purchase order|\\bPO\\b' }],
          actions: { customFields: { enquiry_type: 'purchase_order' } },
        }),
        rule('high', {
          all: [{ field: 'has_attachment', op: 'equals', value: 'true' }],
          actions: { priority: 'high', customFields: { other: 1 } },
        }),
        rule('inactive', {
          active: false,
          all: [{ field: 'from', op: 'contains', value: '@' }],
          actions: { categoryId: 'x' },
        }),
        rule('outgoing', {
          direction: 'outgoing',
          all: [{ field: 'from', op: 'contains', value: '@' }],
          actions: { categoryId: 'y' },
        }),
      ],
      input,
    );
    expect(r).toEqual({
      actions: {
        categoryId: 'do-not-reply',
        priority: 'high',
        customFields: { enquiry_type: 'purchase_order', other: 1 },
      },
      matchedRuleIds: ['noreply', 'po', 'high'],
    });
  });
  it('a rule with no conditions never matches; invalid rules are refused on save', () => {
    expect(applyRoutingRules([rule('empty', { actions: { priority: 'high' } })], input).matchedRuleIds).toEqual([]);
    expect(validateRule({ title: '', all: [], any: [] })).toHaveLength(2);
    expect(validateRule({ title: 'x', all: [{ field: 'subject', op: 'regex', value: '(' }], any: [] })[0]).toMatch(
      /valid pattern/,
    );
  });
});

describe('templates (spec 11.5)', () => {
  it('placeholders are filled and HTML-escaped; unknown ones are left as typed', () => {
    const out = renderTemplate('<p>Hi {contact.name}, re #{ticket.id} for {account.name} ({tier}) {nope}</p>', {
      'contact.name': 'Dana <script>',
      'ticket.id': 42,
      'account.name': 'Northgate',
      tier: 'Gold',
    });
    expect(out).toBe('<p>Hi Dana &lt;script&gt;, re #42 for Northgate (Gold) {nope}</p>');
    expect(placeholdersIn('{a.b} {c} {a.b}')).toEqual(['a.b', 'c']);
  });
  it('signatures keep their line breaks', () => {
    expect(signatureHtml('Kind regards,\nRyan & co')).toBe('<p>Kind regards,<br>Ryan &amp; co</p>');
  });
});
