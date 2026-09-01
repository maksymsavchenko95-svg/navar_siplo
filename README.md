# Navar

Weekly grocery-planning agent built on the official **Silpo MCP**. Reads a household's real
purchase history, builds a menu within a hard budget and food restrictions, and materializes
it into a real Silpo cart. Two goal modes — `routine` (budget-first) and `form` (adds a
protein floor + calorie corridor) — are one solver, different configuration.

See [`CLAUDE.md`](CLAUDE.md) for architecture and [`docs/`](docs/) for the TDD, brief and SRS.

## Quick start

```bash
corepack enable && pnpm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
# set MCP_TOKEN_KEY in .env and apps/api/.env:  openssl rand -base64 32

pnpm dev        # Postgres + API in Docker (API on :3001, auto-migrates)
pnpm db:seed    # demo recipes + household
pnpm dev:web    # Next.js on :3000
```

Connect the Silpo MCP once (opens a browser for the Silpo login):

```bash
pnpm mcp:auth
```

## Checks

```bash
pnpm typecheck    # tsc across every package
pnpm test         # vitest (no DB or network needed)
pnpm build        # tsc check + next build
pnpm format       # prettier --write .
```

`pnpm test` runs recursively; today the suites live in `packages/domain` (unit conversion,
nutrition math) and `packages/retail` (tool-list mapping). Run one package or filter by
file name:

```bash
pnpm --filter @navar/domain test              # one package
pnpm --filter @navar/domain test nutrition    # one file
pnpm --filter @navar/domain exec vitest       # watch mode
```

## Layout

- `apps/api` — Fastify + tRPC; wires the packages together
- `apps/web` — Next.js App Router
- `packages/domain` — Zod schemas, domain types, unit conversions, port contracts
- `packages/db` — Drizzle schema + migrations + encrypted `CredentialStore`
- `packages/retail` — `RetailProvider` + Silpo MCP adapter (only package using the MCP SDK)
- `packages/{planner,mapper,safety}` — deterministic cores (stubs for now)
