# 20. Build plan and acceptance criteria


Build in nine phases; each ends with a running app, seeded demo data, and green tests for every listed criterion. Do not start a phase until the previous one passes.

1.  **Phase 0 — Foundations.** Repo, CLAUDE.md, Docker Compose (app, Postgres, Redis, object storage, test mail server), CI, auth (password + TOTP), user types, access and rights profiles, audit log skeleton, seed script.

    - Done when: an admin can create a user with a restricted rights profile, and that user's API calls to a forbidden module return 403.

2.  **Phase 1 — CRM core.** CRM databases, custom field pool, form builder, contacts, accounts, record types and records, history, contact list filters.

    - Done when: a contact with two emails and a UK phone saves normalised; a user without that database in their rights cannot find it in list, search or API.

3.  **Phase 2 — Tickets without email.** Categories (all settings in 7.1), statuses, priorities, ticket CRUD, list, team/my views, filter schemes, ticket detail with comments and history, followers, @mentions, parent/child, merge, move, state rules in 6.3.

    - Done when: every row of both tables in 6.3 has a passing test, and the auto-fill-user-on-close rule works from the form but not from bulk edit.

4.  **Phase 3 — Email channel.** Mailbox queues, inbound pipeline, threading, contact matching, composing, replies, templates, auto-responses, outbound-creates-ticket, routing rules.

    - Done when: a reply with a changed subject threads to the right ticket; a reply to an Archived ticket creates a new one; a no-reply sender routes to *Do not reply*; an auto-reply never triggers our auto-response.

5.  **Phase 4 — SLA and distribution.** SLA definitions, time groups, account override, deadline maths, Waiting pause, SLA icons, outcome flags, distribution with limits and backlog.

    - Done when: all SLA tests in section 8 pass, and with limit 2 and three new tickets for one eligible agent, the third waits in backlog until one goes to Waiting.

6.  **Phase 5 — Notifications and macros.** Notification rules, in-app centre, real-time presence, optimistic locking, macros.

    - Done when: a *Waiting +2 days, Back* macro sets the fields, saves and returns to the list in one click.

7.  **Phase 6 — Search, bulk, GDPR.** Global search, bulk edit/delete as jobs, import/export with mapping templates, contact merge, anonymise, erasure, subject access export.

    - Done when: erasing a contact leaves no personal data in its tickets' emails or attachments, and the audit log records it.

8.  **Phase 7 — Reporting, KB, portal.** Metrics in 17, knowledge base, external portal.

    - Done when: an external user sees only external comments on their own contacts' tickets and their comment reopens a Closed ticket.

9.  **Phase 8 — QOL and hardening.** Section 19 items, performance targets, accessibility audit, security review, backup restore test.
