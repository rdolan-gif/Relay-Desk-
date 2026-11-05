import MailComposer from 'nodemailer/lib/mail-composer';
import type { INestApplication } from '@nestjs/common';
import { InboundService } from '../src/email/inbound.service';
import { FakeMailProvider } from '../src/email/providers';

export const SUPPORT = 'support@relaydesk.local';

export interface TestMail {
  from: string;
  to?: string;
  subject: string;
  text?: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  headers?: Record<string, string>;
  attachments?: { filename: string; content: string }[];
}

export async function rawMail(m: TestMail): Promise<Buffer> {
  return new MailComposer({
    from: m.from,
    to: m.to ?? SUPPORT,
    subject: m.subject,
    text: m.text ?? 'Hello',
    html: m.html,
    messageId: m.messageId ? `<${m.messageId}>` : undefined,
    inReplyTo: m.inReplyTo ? `<${m.inReplyTo}>` : undefined,
    references: m.references?.map((r) => `<${r}>`).join(' '),
    headers: m.headers,
    attachments: m.attachments,
  })
    .compile()
    .build();
}

/** Delivers a message to the stand-in mailbox and runs one sync. */
export async function receive(app: INestApplication, mailboxId: string, m: TestMail) {
  const fake = app.get(FakeMailProvider);
  fake.deliver(m.to ?? SUPPORT, await rawMail(m));
  const outcomes = await app.get(InboundService).syncMailbox(mailboxId);
  return outcomes.at(-1)!;
}

export function sentCount(app: INestApplication, address = SUPPORT) {
  return app.get(FakeMailProvider).sent.get(address)?.length ?? 0;
}
