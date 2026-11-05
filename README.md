# Relay Desk

Web helpdesk (email-to-ticket) and CRM for support teams: tracked tickets with SLAs, a
linked CRM, configurable permissions, and an external customer portal.

- Build spec: [`docs/spec/`](docs/spec/README.md)
- Build progress: [`docs/progress.md`](docs/progress.md)
- Open questions and assumptions: [`docs/open-questions.md`](docs/open-questions.md)
- Developer guide and commands: [`CLAUDE.md`](CLAUDE.md)

## Quick start

```bash
pnpm install
docker compose up -d postgres redis minio mailpit
pnpm build && pnpm db:migrate && pnpm db:seed
pnpm dev:api    # in one terminal
pnpm dev:web    # in another, then open http://localhost:5173
```

Sign in as `admin@relaydesk.local` with the development password printed by `pnpm db:seed`.
