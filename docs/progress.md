# Build progress

## Owner answers applied (04/11/2026)

| Change                                                                                                                      | Test                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Merged tickets become one; merges can be undone (activities and followers return)                                           | `apps/api/test/tickets.test.ts` (merge, parent/child, move)                            |
| Archived tickets are read-only; Un-archive returns them to a standard ticket                                                | `packages/domain/src/tickets/save-rules.test.ts`, `tickets.test.ts` (archived tickets) |
| Per-person signature, default "Kind regards, <name>"                                                                        | `packages/domain/src/users/user-rules.test.ts`, `apps/api/test/auth.test.ts`           |
| Company › Branch › Branch number with phones, emails and addresses; branch card on tickets; branch and company ticket lists | `packages/domain/src/crm/accounts.test.ts`, `apps/api/test/branches.test.ts`           |
| Support team structure (categories, rights, views)                                                                          | `pnpm db:setup:support` (add `-- --demo` for demo users and data)                      |

## Phase 4 — SLA and distribution ✅

Scope (spec 20): SLA definitions, time groups, account override, deadline maths, Waiting
pause, SLA icons, outcome flags, distribution with limits and backlog.

**Done when:** all SLA tests in section 8 pass, and with limit 2 and three new tickets for
one eligible agent, the third waits in backlog until one goes to Waiting.

| Criterion / rule                                                                                            | Test                                                                   |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 16:00 Friday + 4 h, Mon–Fri 09–17 → Monday 12:00; with a Monday bank holiday → Tuesday 12:00                | `packages/domain/src/sla.test.ts`                                      |
| Response 1 h + Solution 8 h, created 10:00 Tuesday → first answer 11:00 Tuesday, deadline 11:00 Wednesday   | `sla.test.ts`, `apps/api/test/phase4-acceptance.test.ts`               |
| Waiting 12:00–15:00 the same working day → deadline 3 working hours later                                   | `sla.test.ts`, `phase4-acceptance.test.ts`                             |
| Account SLA used with the category's working hours (branches use the company's)                             | `sla.test.ts`, `phase4-acceptance.test.ts`                             |
| DST weekend in Europe/London does not shift working hours                                                   | `sla.test.ts`                                                          |
| Recalculate on priority / category / account / working-hours change; a manual deadline never recalculates   | `sla.test.ts`, `phase4-acceptance.test.ts`                             |
| What counts as a response (agent email, not auto-responses); FYI never counts as missed (owner O-12)        | `sla.test.ts`, `phase4-acceptance.test.ts`                             |
| Outcome flags first_answer_met / solution_met stored and frozen; the minute job decides missed ones         | `sla.test.ts`, `phase4-acceptance.test.ts`                             |
| SLA icons: hand → stopwatch; counting, paused, overdue, met, missed; none without SLA or deadline           | `sla.test.ts`, `phase4-acceptance.test.ts`, `e2e/tests/phase4.spec.ts` |
| Reply targets by enquiry type: purchase order 2 h, quotation 4 h, else 8 h (owner O-11)                     | `sla.test.ts`, `phase4-acceptance.test.ts`                             |
| Time groups and SLAs validated; UK bank holidays importable (GOV.UK, built-in fallback)                     | `sla.test.ts`, `phase4-acceptance.test.ts`, `e2e/tests/phase4.spec.ts` |
| **Limit 2, three new tickets, one eligible agent → the third waits until one goes to Waiting**              | `phase4-acceptance.test.ts`, `sla.test.ts` (distribution)              |
| Eligibility: Access, a limit, queue in rights, Ready for email, below limit; fewest Open, then longest idle | `sla.test.ts`, `phase4-acceptance.test.ts`                             |
| Backlog is FIFO; logging in, Waiting/Closed or reassigning retries it; concurrent runs never exceed the cap | `phase4-acceptance.test.ts`                                            |
| UI: SLA icon on a ticket, Ready for email, SLA and working-hours settings                                   | `e2e/tests/phase4.spec.ts`                                             |

What exists:

- Domain: `sla/working-time.ts` (add/count working minutes in a timezone, exceptions),
  `sla/sla.ts` (targets, deadlines, Waiting pause, outcome flags, icon state),
  `sla/bank-holidays.ts` (GOV.UK parser, built-in England and Wales list),
  `sla/distribution.ts` (eligibility, pick, backlog plan).
- API: `/api/settings/slas` (CRUD, `basis-fields`), `/api/settings/time-groups` (CRUD,
  `import-bank-holidays`), `/api/sla-options`, `/api/me/queues` (Ready for email); SLA and
  working hours on categories, SLA on accounts; every ticket write recalculates its SLA in the
  same transaction (`SlaService.refresh`); list rows and the ticket carry `sla`; the minute job
  decides overdue outcomes and retries the distribution backlog.
- Web: SLA icon in the Deadline column and the ticket header (tooltip with all times),
  Ready for email in the header, Settings › SLAs and Settings › Working hours (weekly hours,
  exceptions, Import UK bank holidays), SLA and working hours on categories, SLA on accounts.
- Seed: "Office hours (demo)" and "Standard support (demo)" on Support. `pnpm db:setup:support`
  adds "Ricoman office hours" (Mon–Thu 08:30–17:00, Fri 08:30–16:00, bank holidays) and
  "Reply targets" (by enquiry type) on every Ricoman category.

Deferred, deliberately:

- Notifying the new owner on (re)assignment is Phase 5 (notifications).
- Calls and chat as "responses" arrive with those channels (not planned for Ricoman).
- Distribution runs in the API process with an advisory lock; it moves to a job queue if
  volumes grow.

## Phase 3 — Email channel ✅

Scope (spec 20): mailbox queues, inbound pipeline, threading, contact matching, composing,
replies, templates, auto-responses, outbound-creates-ticket, routing rules. Gmail through the
free Gmail API (owner O-2, O-10).

**Done when:** a reply with a changed subject threads to the right ticket; a reply to an
Archived ticket creates a new one; a no-reply sender routes to _Do not reply_; an auto-reply
never triggers our auto-response.

| Criterion / rule                                                                                         | Test                                                                           |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A reply with a changed subject threads by its headers to the right ticket                                | `apps/api/test/phase3-acceptance.test.ts`, `packages/domain/src/email.test.ts` |
| A reply to an Archived ticket creates a new ticket                                                       | `phase3-acceptance.test.ts`, `email.test.ts` (domain)                          |
| A no-reply sender routes to _Do not reply_                                                               | `phase3-acceptance.test.ts`                                                    |
| An auto-reply never triggers our auto-response; "only for new tickets" and on/off respected              | `phase3-acceptance.test.ts`, `email.test.ts` (domain)                          |
| Each email is processed once; our own mail is dropped as a loop; bounces mark the sent email Failed      | `apps/api/test/email.test.ts`                                                  |
| Several header matches: newest ticket wins, others suggested; `[#123]` token fallback; merged → survivor | `email.test.ts` (API and domain)                                               |
| Sender matched to a contact in the mailbox's CRM databases; customer email reopens Waiting               | `email.test.ts`                                                                |
| HTML sanitised; attachments stored, downloadable and attachable (uploader only, 25 MB per email)         | `email.test.ts`                                                                |
| Reply / Reply all / Forward with threading headers and the ticket token; first agent reply recorded      | `email.test.ts`, `e2e/tests/phase3.spec.ts`                                    |
| A new email creates a ticket (Closed, Low, sender as User, matched contact)                              | `email.test.ts`, `e2e/tests/phase3.spec.ts`                                    |
| Failed sends are kept and marked Failed with the reason                                                  | `email.test.ts`                                                                |
| Mailbox rights; back-office users cannot send                                                            | `email.test.ts`                                                                |
| Routing: all matching rules apply in order, later wins; all/any groups; invalid patterns refused         | `email.test.ts` (API and domain)                                               |
| Enquiry type set by rules: purchase order / quotation (owner O-11)                                       | `email.test.ts`                                                                |
| Templates by agents with placeholders; signatures (owner O-6, O-7)                                       | `email.test.ts` (API and domain)                                               |
| "FYI – no reply needed" closes with the FYI status (owner O-12)                                          | `email.test.ts`                                                                |
| Gmail OAuth: forged state refused, wrong account refused, credentials never returned                     | `email.test.ts`, `apps/api/src/email/gmail.provider.test.ts`                   |
| Pasted or malformed recipient addresses are refused                                                      | `packages/domain/src/crm/identifiers.test.ts`                                  |
| UI: new email → ticket → reply; Mailboxes and Email routing settings                                     | `e2e/tests/phase3.spec.ts`                                                     |

What exists:

- API: `/api/settings/mailboxes` (CRUD, `connect`, `disconnect`, `sync`, `log`),
  `/api/oauth/google/callback`, `/api/settings/email-routing` (CRUD, `PUT order`),
  `/api/templates` (CRUD, `render`), `/api/mailboxes` (mine), `/api/emails` (send),
  `/api/attachments` (upload/download), `/api/tickets/:id/fyi`,
  `/api/tickets/:id/merges/:mergeId/undo`. Mail is checked every `MAIL_POLL_SECONDS` (60).
- Web: emails on the ticket (sandboxed body, attachments, Reply / Reply all / Forward),
  composer (From, To/Cc/Bcc, subject, signature, quoted text, templates, attachments,
  "Save & send email"), suggested-ticket banner with "Move to #id", FYI button, New email
  from the ticket list, Email templates page for agents, Settings › Mailboxes (Connect Gmail,
  status, check now, log), Settings › Email routing (ordered rules, condition and action
  editor), mailboxes on rights profiles.
- Seed: a demo mailbox `support@relaydesk.local` (fake provider), FYI status, _Do not reply_
  category, Enquiry type field and rules. `pnpm db:setup:support` adds the four Ricoman Gmail
  inboxes. Google setup: `docs/setup/gmail.md`.

Deferred, deliberately:

- Reply targets (2/4/8 working hours by enquiry type) are Phase 4 (SLA).
- Contact/account custom-field conditions in the routing editor UI (supported by the API).
- Gmail push notifications (Pub/Sub) instead of polling; polling every minute is free and enough
  for 20–30 emails a day.

## Phase 2 — Tickets without email ✅

Scope (spec 20): categories (all settings in 7.1), statuses, priorities, ticket CRUD, list,
team/my views, filter schemes, ticket detail with comments and history, followers,
@mentions, parent/child, merge, move, state rules in 6.3.

**Done when:** every row of both tables in 6.3 has a passing test, and the
auto-fill-user-on-close rule works from the form but not from bulk edit.

| Criterion / rule                                                                                                                                                                            | Test                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Every row of 6.3 table 1 (customer email by state) and table 2 (automatic reopen), plus the no-change list and "manual state wins"                                                          | `packages/domain/src/tickets/state.test.ts` (one test per row)                        |
| Table rows Phase 2 can drive end-to-end: other user's comment reopens Waiting/Closed; re-open time reopens Waiting/Closed; own/unassigned comments, moves and Archived tickets don't change | `apps/api/test/phase2-acceptance.test.ts`, `e2e/tests/phase2.spec.ts`                 |
| Auto-fill User on close/archive from the form, not from bulk edit; a macro-set user wins                                                                                                    | `tickets/save-rules.test.ts`, `phase2-acceptance.test.ts`, `e2e/tests/phase2.spec.ts` |
| Deactivated owner cleared on next save; deactivated users stop following                                                                                                                    | `save-rules.test.ts`, `apps/api/test/tickets.test.ts`                                 |
| Category settings: status required, multiple statuses, allowed statuses, waiting needs re-open, check children on close/delete, auto-archive                                                | `save-rules.test.ts`, `tickets.test.ts`                                               |
| Category rights: Access = No → can create but not see; category not in rights → refused                                                                                                     | `tickets/rights` tests in `save-rules.test.ts`, `tickets.test.ts`                     |
| Comments: sanitised HTML, mentions and followers, author-only edits logged with old/new                                                                                                     | `tickets.test.ts`                                                                     |
| Merge, parent/child (no cycles, from an activity), move activity                                                                                                                            | `tickets.test.ts`, `phase2-acceptance.test.ts`                                        |
| Filters, `@me`, search by title/description/comment/#number, team views from rights, My views and sidebar                                                                                   | `tickets.test.ts`, `e2e/tests/phase2.spec.ts`                                         |
| Optimistic locking (version conflict → 409 with current values)                                                                                                                             | `tickets.test.ts`                                                                     |
| Contact card with other open tickets                                                                                                                                                        | `tickets.test.ts`                                                                     |

What exists:

- API: `/api/settings/{ticket-statuses,categories,ticket-views}`, `/api/tickets/meta`,
  `/api/tickets/views` (+ `/sidebar`), `/api/tickets` (list with `viewId`/`q`/`filter`,
  CRUD, history, snapshot, activities, comments and edits, move, children, follow,
  favourite), `/api/tickets/bulk-edit`, `/api/tickets/merge`; tickets in global search;
  re-open and auto-archive jobs (every minute).
- Web: Tickets menu with a views sidebar (all tickets, My views with reorder/remove, team
  views with pin, + New view), list with filters, saved filters, columns, bulk edit and
  merge; ticket detail with header (#ID, copy link, favourite, state, priority, parent,
  merged-into), activities with rich-text comments, mentions, edit and actions, history
  interleaved with activities (hide toggle, side-by-side comment diffs, "view form as it
  was"), form with contact card, category, priority, state, user, deadline, re-open,
  followers, status(es), description and the category's custom form, layout 2:1/1:1/1:2,
  "Save ticket & comment"; Settings pages for categories (with form builder), statuses and
  team views; category Access/limit and team views on rights profiles.
- Seed: four statuses, Support/Billing/Intake categories (agents can't see Intake), two
  team views ("My open tickets", "Unassigned"), three tickets.

Deferred to their phases (see `docs/open-questions.md`):

- Presence avatars (5), SLA icons and deadlines (4), suggested-ticket banner, Templates
  tab and comment attachments (3), iFrame tabs and time tracking/"Sessions view" (later,
  [SHOULD]), peek panel ([SHOULD]), bulk edit as a background job above 200 (6).

## Phase 1 — CRM core ✅

Scope (spec 20): CRM databases, custom field pool, form builder, contacts, accounts,
record types and records, history, contact list filters.

**Done when:** a contact with two emails and a UK phone saves normalised; a user without
that database in their rights cannot find it in list, search or API.

| Criterion / rule                                                                                        | Test                                                                   |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Two emails and a UK phone save normalised (lower-case; E.164)                                           | `apps/api/test/phase1-acceptance.test.ts`, `e2e/tests/phase1.spec.ts`  |
| No database in rights → not in list, `q` search, filters, global search, by-id API, metadata            | `phase1-acceptance.test.ts`, `e2e/tests/phase1.spec.ts`                |
| Email/phone normalisation, UK display format                                                            | `packages/domain/src/crm/identifiers.test.ts`                          |
| Custom field types, immutable key/type, option-removal usage warning, delete blocked while on a form    | `custom-fields/fields.test.ts`, `apps/api/test/crm.test.ts`            |
| Form layouts: validation, required, read-only, hidden, defaults, dynamic visibility                     | `forms/form-layout.test.ts`, `crm.test.ts`, `e2e/tests/phase1.spec.ts` |
| Exactly one default CRM database; delete rules                                                          | `crm.test.ts`                                                          |
| Contacts, accounts, records CRUD; contact and account in the same database; record status from its type | `crm.test.ts`, `crm/records.test.ts`                                   |
| Record types in rights; linked names hidden when their database is hidden                               | `crm.test.ts`                                                          |
| History with old/new values; form as it was at any past point                                           | `history/snapshot.test.ts`, `crm.test.ts`                              |
| List filters (is, is not, contains, empty, before/after, in last N days), search, sort, paging          | `filters/filters.test.ts`, `crm.test.ts`                               |
| Saved filter schemes (private), column choices per user                                                 | `crm.test.ts`                                                          |
| Possible-duplicate warning (never blocks)                                                               | `crm.test.ts`                                                          |
| Rights: CRM scopes can't be delegated beyond your own                                                   | `crm.test.ts`                                                          |

What exists:

- API: `/api/settings/{custom-fields,crm-databases,crm-record-types}`, `/api/crm/meta`,
  `/api/crm/{contacts,accounts,records}` (list with `q`/`filter`/`sort`/paging, CRUD,
  `/history`, `/snapshot?at=`, linked records/contacts), `/api/crm/contacts/duplicate-check`,
  `/api/me/lists/...` (filter schemes, columns), `/api/directory/users`, `/api/search`.
- Web: CRM menu (contacts, accounts, records) with search, filter builder, saved filters,
  column chooser, paging; detail pages with custom forms, linked records, history and
  "view form as it was"; top-bar search; Settings pages for custom fields, CRM databases
  (drag-and-drop contact/account form builder) and record types; CRM scopes on rights
  profiles.
- Seed: Customers (default, agents can see) and Partners (admins only) databases, six demo
  fields, three contacts, two accounts, a Deal record type and one deal.

Deferred, per the build plan or for later decision (see `docs/open-questions.md`):

- Import/export, merge, bulk edit, delete-recovery and anonymise: Phase 6.
- Contact Activities and Tickets tabs: Phases 2–3. Attachments and iFrame tabs: later
  (need object storage / categories).
- Account SLA: Phase 4. Contact card in the ticket: Phase 2.

## Phase 0 — Foundations ✅

Scope (spec 20): repo, CLAUDE.md, Docker Compose (app, Postgres, Redis, object storage, test
mail server), CI, auth (password + TOTP), user types, access and rights profiles, audit log
skeleton, seed script.

**Done when:** an admin can create a user with a restricted rights profile, and that user's
API calls to a forbidden module return 403.

| Criterion / rule                                                                                      | Test                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Admin creates a restricted user; their calls to a forbidden module return 403 (session and API token) | `apps/api/test/phase0-acceptance.test.ts`                                             |
| Non-administrator types never reach Settings                                                          | `phase0-acceptance.test.ts`, `packages/domain/src/permissions/access-profile.test.ts` |
| Profile changes take effect on the user's next request                                                | `phase0-acceptance.test.ts`                                                           |
| Access = modules + CRUD + flags; external users refused                                               | `access-profile.test.ts`                                                              |
| Rights: user visibility; profile editing limited to editable lists                                    | `rights-profile.test.ts`, `users-and-profiles.test.ts`                                |
| Privilege escalation guard                                                                            | `users-and-profiles.test.ts` (privilege escalation guard)                             |
| Type change blocked while logged in                                                                   | `user-rules.test.ts`, `users-and-profiles.test.ts`                                    |
| Deactivation logs out and revokes API token                                                           | `auth.test.ts`                                                                        |
| Password strength, rate-limited login, TOTP 2FA, CSRF, API token                                      | `auth.test.ts`, `password-policy.test.ts`                                             |
| Audit log records security and config events with diffs                                               | `auth.test.ts`, `users-and-profiles.test.ts`, `audit-events.test.ts`                  |
| UI: sign-in, Settings visibility by type                                                              | `e2e/tests/phase0.spec.ts`                                                            |

What exists:

- API: `/api/auth/*` (login with optional TOTP, logout, me, password, TOTP setup/confirm/disable,
  API token), `/api/settings/users`, `/api/settings/access-profiles`,
  `/api/settings/rights-profiles`, `/api/settings/audit-log`, `/api/health/{live,ready}`,
  OpenAPI at `/api/docs`.
- Web: sign-in (with 2FA step), My account (password, 2FA with QR, API token), Settings:
  users, access profiles (module × CRUD grid + flags), rights profiles, audit log. Light/dark.
- Seed: Administrator / Agent / Back-office access profiles, Administrator / Standard agent
  rights profiles, three demo users.

Deferred from Phase 0, deliberately:

- Google/Microsoft SSO is [SHOULD]; not built yet (open question Q-P0-9).
- Redis, MinIO and Mailpit are in Compose but unused until jobs, files and email arrive.
- The audit retention purge (`AuditService.purgeExpired`) exists; it gets scheduled once the
  job queue lands.
- Rights for categories, views, queues, CRM databases, record types, macros and KB folders are
  added by the phase that introduces each entity.
