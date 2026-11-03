# 11. Email channel


Every email belongs to a ticket: a mailbox queue pulls each inbound email into a new or existing ticket and sets its category, then ordered routing rules refine the ticket's fields ([How Email Works](https://docs.daktela.com/contact-centre/administrator/email/)).

### 11.1 Mailbox queues \[MUST\]

- Connection: IMAPS or POP3S for inbound, SMTPS for outbound, or OAuth2 for Gmail and Microsoft 365. Credentials are stored encrypted. A real mailbox is required, not an alias.

- Settings: title, sender name and address, default category, signature template, auto-response template (with on/off and only-for-new-tickets option), default body template, *enable header threading*, active flag (inactive = stop receiving, sending still works), agents (via rights), linked CRM databases (for contact matching).

- Polling: every 60 seconds by default (IMAP IDLE where available). Track processed UIDs so restarts never duplicate or skip mail. Store the raw .eml for every message.

### 11.2 Inbound processing pipeline \[MUST\]

1.  Fetch the message; store raw; parse headers, bodies (HTML sanitised against XSS, plain-text fallback) and attachments (virus scan hook).

2.  Drop or flag loops and bounces: ignore mail from our own queue addresses; detect auto-replies (Auto-Submitted, X-Autoreply, Precedence: bulk) and never send an auto-response to them.

3.  Thread: if header threading is on, look up existing tickets whose activities have a Message-ID matching this mail's In-Reply-To or References. Fallback: a ticket reference token in the subject (e.g. \[#1234\]).

4.  Exactly one match and that ticket is not Archived → append the email to it. Several matches → append to the most recent and show the suggested-ticket banner (6.2). Matched ticket Archived, or no match → create a new ticket with title = subject and category = queue's default.

5.  Match the sender to a contact (section 12.3) and set it as the ticket's contact if empty.

6.  Apply email routing rules (11.3) to new tickets only.

7.  Apply automatic state rules (6.3), recalculate SLA, run distribution (9), send notifications (13), send auto-response if configured.

### 11.3 Email routing rules \[MUST\]

An ordered list of rules, each with: title, description, direction (incoming / outgoing / both), active flag, a condition set and actions.

- **Conditions** on: from address/domain, to/cc address, subject, body, queue, has attachment, sender's contact/account field values. Operators: equals, contains, starts with, ends with, regex, is empty. Combine with *all of these* (AND) and *any of these* (OR) groups.

- **Actions:** set category (overrides the queue's), user, status, state, priority, and custom fields. Custom fields apply only if the rule also sets a category whose form contains that field; the editor shows a warning banner when custom fields are configured.

- Evaluate rules top to bottom; the first matching rule wins and evaluation stops \[assumption: confirm in section 21\]. No match = ticket keeps the queue's category and other fields stay blank.

- Examples to seed: sender contains "noreply" → category *Do not reply*; domain vip-client.com → priority High; subject contains "complaint" → category *Complaints*.

- Import/export of rules (title, description, direction only) \[LATER\].

### 11.4 Composing and sending \[MUST\]

- Rich-text editor with To, Cc, Bcc, From (allowed queues), subject, body, attachments (max 25 MB total), templates panel, signature auto-inserted.

- Reply quotes the original; Reply all includes original recipients minus our own addresses; Forward includes attachments.

- **Scheduled send \[SHOULD\]:** pick a future date-time; the email shows as Scheduled and can be edited or cancelled until sent.

- Outbound headers: set Message-ID (stored), In-Reply-To and References for replies, so customers' replies thread back.

- Delivery failures (SMTP error, bounce) mark the activity Failed and notify the author.

### 11.5 Templates \[MUST\]

Types: auto-response, signature, default email body, reply template. Rich text with placeholders such as {ticket.id}, {ticket.title}, {contact.name}, {user.name}, {account.name} and any custom field key. Templates can be limited to specific queues or categories.
