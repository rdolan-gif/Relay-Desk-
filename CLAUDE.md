# Relay Desk — guidance for Claude Code

Relay Desk is a web helpdesk (email-to-ticket) and CRM. **The spec in `docs/spec/` is the
source of truth** (start at `docs/spec/README.md`; section 19 overrides earlier sections).
If something is unspecified, choose the simplest reasonable behaviour and log it in
`docs/open-questions.md`. Never copy another vendor's name, branding, text or assets.

## Status

Build strictly in the phase order of `docs/spec/20-build-plan-and-acceptance-criteria.md`.
Progress and the test for each acceptance criterion: `docs/progress.md`.

- Phase 0 (foundations): **done**
- Phase 1 (CRM core): **done**
- Phase 2 (tickets without email): **done**
- Next: Phase 3 (email channel)

## Stack

TypeScript everywhere · pnpm workspaces · Node 22

| Path                 | What                                                                      |
| -------------------- | ------------------------------------------------------------------------- |
| `packages/domain`    | Pure business rules (no I/O, no frameworks). ESM. Vitest unit tests.      |
| `apps/api`           | NestJS 11 REST API, Drizzle ORM on PostgreSQL 16, OpenAPI at `/api/docs`. |
| `apps/web`           | React 19 + Vite + TanStack Query + Mantine 8.                             |
| `e2e`                | Playwright end-to-end tests against the built API and web app.            |
| `docker-compose.yml` | Postgres, Redis, MinIO (S3), Mailpit (test SMTP), api, web.               |

## Commands

```bash
pnpm install
docker compose up -d postgres redis minio mailpit   # or use a local Postgres 16
pnpm build            # domain must be built before api/web typecheck (types come from dist)
pnpm db:migrate       # apply drizzle migrations to DATABASE_URL
pnpm db:seed          # idempotent demo data; dev password harbour-lantern-violet-42
pnpm dev:api          # http://localhost:3000/api (tsx watch)
pnpm dev:web          # http://localhost:5173 (proxies /api to :3000)
pnpm lint && pnpm typecheck
pnpm test             # domain unit + api integration (needs TEST_DATABASE_URL db) + web unit
pnpm test:e2e         # needs migrated+seeded DATABASE_URL and `pnpm build`
pnpm db:generate      # after editing apps/api/src/db/schema.ts: creates a new SQL migration
```

Seeded users: `admin@relaydesk.local` (Administrator), `agent@relaydesk.local` (Agent),
`backoffice@relaydesk.local` (Back-office).

Integration tests drop and recreate the schema of `TEST_DATABASE_URL`
(default `postgres://relay:relay@localhost:5432/relay_desk_test`) — never point it at real data.

## Conventions

- **Business rules live in `packages/domain`** and are unit tested exhaustively. API and UI call
  into it. ESLint blocks framework/I/O imports there.
- **Tests are named after the rule** they prove ("when X, the system Y"). Every acceptance
  criterion in spec 20 gets a test; list it in `docs/progress.md`.
- **Authorisation is default-deny.** The global `AuthGuard` rejects any route without one of
  `@Public()`, `@AuthenticatedOnly()`, `@RequireAccess(module, verb)` or `@RequireFlag(flag)`.
  Data scoping (rights) is applied in services, never only in the UI.
- **Inject with explicit tokens** (`@Inject(Service)`) in every Nest constructor. `tsx` and
  Vitest use esbuild, which does not emit decorator metadata.
- **Validate input with zod** via `ZodPipe`. Errors are `{ message, reason }`; `reason` is a
  stable machine code that tests assert on.
- **Audit and history entries are written in the same transaction** as the change (pass `tx`).
  Never log secret values; `diffFields` redacts known sensitive fields.
- **Secrets at rest** use `SecretBox` (AES-256-GCM, `ENCRYPTION_KEY`). Passwords: argon2id.
- **Soft delete** (`deleted_at`) anything referenced elsewhere.
- **Schema changes**: edit `apps/api/src/db/schema.ts`, run `pnpm db:generate`, commit the SQL.
- **UI strings** go in `apps/web/src/i18n/en-GB.ts` (British English). Dates via
  `formatDateTime` (DD/MM/YYYY, 24-hour, user timezone). Keep components keyboard accessible.
- API in CommonJS (NestJS), domain in ESM; Node 22 `require(esm)` bridges them.
- **Web gotchas**: Mantine `Select` treats items with a `group` key as option groups (use
  `{ group, items }`); searchable selects must keep option labels stable or they loop; avoid
  `SegmentedControl` (use `components/Segmented`).
- **CRM scoping**: contacts/accounts by `rights.crmDatabases`, records by `rights.crmRecordTypes`;
  use `scopeSql` in lists and `find()` (404 when out of scope) for single items. Any new list,
  search or export must apply the same scope.
- **Custom values** are stored as JSONB keyed by field id and always go through
  `applyCustomInput` (layout rules + type validation). History flattens them to `custom.<id>`.
- **Ticket rules**: state changes go through `applySaveRules` (with the right `SaveSource`) and
  `automaticState`/`resolveState`; tickets are scoped by `auth.ticketRights` (category Access)
  via `TicketsService.find()` / `categoryScope()`. Comment/description HTML goes through
  `sanitizeRich`.
- **Filters**: validate with domain `validateConditions`, translate with `filterSql`; keep
  `matchesConditions` (domain) and `conditionToSql` (API) in agreement.
