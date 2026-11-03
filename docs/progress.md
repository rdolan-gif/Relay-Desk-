# Build progress

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
