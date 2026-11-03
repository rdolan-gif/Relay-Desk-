# Build progress

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
