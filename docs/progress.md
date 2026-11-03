# Build progress

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
