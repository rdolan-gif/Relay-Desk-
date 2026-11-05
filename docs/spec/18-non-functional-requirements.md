# 18. Non-functional requirements


**Suggested stack** (Claude Code may propose an alternative with reasons before Phase 0 starts):

| Layer             | Choice                                                                                                                    |
|-------------------|---------------------------------------------------------------------------------------------------------------------------|
| Language          | TypeScript end to end                                                                                                     |
| Backend           | Node.js with NestJS (modular, DI, good for a domain layer)                                                                |
| Database          | PostgreSQL 16 (JSONB for custom fields, full-text search)                                                                 |
| Jobs and realtime | Redis + BullMQ for mail polling, distribution, SLA timers, imports; WebSocket for presence and notifications              |
| Frontend          | React + TypeScript, TanStack Query, a component library with accessible defaults                                          |
| Files             | S3-compatible object storage                                                                                              |
| Email             | IMAP/SMTP libraries with OAuth2 for Google and Microsoft                                                                  |
| Tests             | Unit (domain), integration (API + DB), end-to-end (Playwright), plus a local test mail server (e.g. GreenMail or Mailpit) |
| Deploy            | Docker Compose for local; containers on a UK/EU region for production                                                     |

**Architecture:** modular monolith with modules matching this spec's sections. REST API (OpenAPI documented) is the only way the frontend talks to the backend, so the same API serves integrations. Outbound webhooks for ticket created/updated, contact created/updated, record created/updated \[SHOULD\].

**Security \[MUST\]:** OWASP ASVS level 2 as the target; HTML email sanitisation; CSRF protection; rate-limited login; secrets encrypted at rest; TLS everywhere; per-request authorisation checks in the domain layer, never only in the UI.

**Data protection \[MUST\]:** UK GDPR and Data Protection Act 2018 — data hosted in the UK or EU, encryption at rest, the GDPR tools in section 14, data processing records, documented backups (daily, 30-day retention, tested restores).

**Performance targets:** ticket list first page \< 500 ms at 1 million tickets; ticket detail \< 800 ms with 200 activities; inbound email visible as a ticket \< 90 s after arrival; 200 concurrent agents.

**Accessibility and UX:** WCAG 2.2 AA; full keyboard navigation with documented shortcuts; light and dark themes; British English UI strings stored for later translation; dates in DD/MM/YYYY and 24-hour time by default, per-user timezone.

**Operations:** structured logs, health endpoints, error tracking, metrics on mail lag and job queues.
