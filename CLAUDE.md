# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Navar is

Navar is an agent that runs a household's **weekly grocery cycle**: it reads real
purchase history, builds a menu that fits a hard budget and food restrictions, materializes
it into a real Silpo cart, and takes it to checkout (or to an offline shopping list). It is
a layer on top of the Silpo ecosystem via the official Silpo MCP server — it has no catalog,
prices, payments, or user identity of its own.

Positioning: not "another recipe chat" (Silpo already ships one). The differentiator is the
_weekly loop_ + _budget as a hard constraint_ + _consumption model derived from receipts_.

Two goal modes — `routine` (budget-first) and `form` (adds a daily protein floor and a
calorie corridor) — are **one solver with different configuration**, never a code branch
(ADR-09).

## Repository state

Boilerplate stage — a runnable skeleton, no product features yet. pnpm monorepo laid out
per `docs/tdd-navar.md` §2.

| Path                           | What it is                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`              | `@navar/domain` — Zod schemas, inferred types, unit conversions, cross-package port contracts (`CredentialStore`). Depends only on zod. Imported by everything (ADR-01).                                                                                                                                                                                 |
| `packages/db`                  | `@navar/db` — Drizzle schema + migrate + seed + the Postgres-backed `CredentialStore` (AES-256-GCM). The only package that touches the database.                                                                                                                                                                                                         |
| `packages/retail`              | `@navar/retail` — `RetailProvider` seam + Silpo MCP adapter + OAuth. Typed methods: `listTools`, `getCartContext`, `findProducts` (`silpo/parse.ts` maps the raw responses); `rawToolList` / `callToolRaw` are audit-only escape hatches, not runtime paths. **The only package that imports `@modelcontextprotocol/sdk`** (ADR-04); a grep enforces it. |
| `packages/planner`             | `@navar/planner` — deterministic solver + LLM planning layer. Stub; exports the `SolverInput` / `WEIGHTS` contract (TDD §4, ADR-09).                                                                                                                                                                                                                     |
| `packages/mapper`              | `@navar/mapper` — ingredient ↔ SKU matching. Stub (TDD §5). The demo's naive first-match lives in the API, not here.                                                                                                                                                                                                                                     |
| `packages/safety`              | `@navar/safety` — food-safety guardrails, deterministic + fail-closed. Stub; re-exports `assertKcalFloor` (SRS §6.8, `FR-SAFE-009`).                                                                                                                                                                                                                     |
| `apps/api`                     | Fastify + tRPC. Thin: wires the packages, `/health`, router (`hello`, `recipes.list`, `recipes.skuCandidates`, `mcp.listTools`), `src/scripts/{mcp-auth,mcp-tools-snapshot,mcp-audit,mcp-audit-cart}.ts` (`audit-util.ts` = their tested pure helpers).                                                                                                  |
| `apps/web`                     | Next.js (App Router). `app/page.tsx` composes `components/` (HelloCard, RecipesSection → RecipeList + RecipeShopping, McpStatus). Runs on the host.                                                                                                                                                                                                      |
| `designs/navar_design/`        | Standalone Gemini / AI-Studio design prototype (Vite + React 19 + Tailwind v4; its own nested git repo; gitignored here). **Visual reference, not a spec** — see "Design reference" below.                                                                                                                                                               |
| `docker-compose.yml`           | `db` (pgvector/pgvector:pg16) + `api`, both containerised. `web` runs on host.                                                                                                                                                                                                                                                                           |
| `docs/tdd-navar.md`            | Phase-0 technical design **v0.2** (adds `routine`/`form` goal modes, nutrition, ADR-09): ADRs, schema, solver + mapping specs, 13-day plan. The build guide.                                                                                                                                                                                             |
| `docs/srs.md`                  | Requirements spec **v0.1** — behind the TDD. `FR-GOAL-*`, `FR-SAFE-009`, `ASM-06`, `RISK-09/10`, `Q-09` live in the TDD until the SRS is refreshed to v0.2.                                                                                                                                                                                              |
| `docs/product-brief.md`        | Problem, market, differentiation, target user, metrics.                                                                                                                                                                                                                                                                                                  |
| `docs/mcp-reference.md`        | Silpo MCP reference: endpoint, OAuth flow, the tools, workflows (docs lag — the server returns 40, not 39).                                                                                                                                                                                                                                              |
| `docs/mcp-audit-checklist.md`  | Day-1 manual audit of the live MCP → a decisions table. Run before building the solver.                                                                                                                                                                                                                                                                  |
| `docs/mcp-audit-results.md`    | M0 audit output (2026-09-01): filled decisions table, trigger decisions, per-block findings, build follow-ups. Raw redacted responses under `docs/mcp-audit-raw/`. The M2 gate.                                                                                                                                                                          |
| `docs/mcp-tools-snapshot.json` | Raw `tools/list` (full schemas), committed as the contract fixation. Regenerate: `pnpm mcp:tools-snapshot`. Reference only — never hardcode from it.                                                                                                                                                                                                     |
| `docs/hackathon-rules.md`      | Hackathon rules — background; `.claude/rules/hackathon.md` is the working checklist.                                                                                                                                                                                                                                                                     |
| `.claude/rules/`               | Standing engineering rules for all code (imported below).                                                                                                                                                                                                                                                                                                |

Workspace packages are consumed as **TypeScript source** (`exports` → `src/index.ts`).
`apps/web` lists `@navar/db` / `@navar/retail` as devDependencies only so `tsc` can resolve
the tRPC `AppRouter` context type — they are never bundled (client imports are `import type`).

## Target stack (`docs/srs.md` §4.2, `docs/tdd-navar.md` §1)

Scaffolded: TypeScript (Node 22) pnpm monorepo · Fastify + tRPC + Zod · PostgreSQL 16 +
pgvector + pg_trgm · Drizzle ORM · `@modelcontextprotocol/sdk` (StreamableHTTP) · Next.js
(App Router) · Docker Compose.

Not yet added (introduce when a feature needs it): BullMQ + Redis, Claude via Vercel AI SDK,
Langfuse + OpenTelemetry + Sentry, app auth/sessions, the plan / receipt / pantry /
shopping-list tables (`docs/tdd-navar.md` §3), the YAML recipe corpus + importer (§2), the
solver itself (incl. portion-fit), `household.computeNutrition` (body metrics → targets),
the goal-selection UI.

Runtime is `tsx` (dev and prod). `pnpm build` / `pnpm typecheck` run `tsc` as a check only —
no JS emit.

## Data model

`packages/db/src/schema.ts` — the identity + recipe-corpus subset of `docs/tdd-navar.md` §3:
`households` (incl. `goal` = routine|form), `household_members`, `household_restrictions`,
`nutrition_targets`, `mcp_credentials`, `canonical_ingredients`, `recipes`,
`recipe_ingredients`. IDs are `uuid` with a separate unique `slug` (the human key for the
corpus and the golden mapping dataset). MCP tokens are AES-256-GCM ciphertext in
`mcp_credentials.payload`, scoped per household (`NFR-SEC-001`).

Nutrition (`form` mode): `canonical_ingredients` and `recipes` carry per-100 g / per-serving
macros; recipe macros are **computed from the ingredients on import**, never hand-set (like
the allergen union). `nutrition_targets.kcal_target` has a DB `CHECK (>= 1200)` — the
`FR-SAFE-009` calorie floor, also enforced in `assertKcalFloor` and `nutritionTargetsSchema`.

Edit the schema, then `pnpm db:generate` to regenerate SQL under `packages/db/drizzle/`.
`pnpm db:seed` is non-destructive — it upserts the demo household on `silpo_user_ref='demo'`,
so `mcp_credentials` survives a re-seed.

## Architecture invariants

These hold for every change and are expanded in `.claude/rules/`:

- **All Silpo data goes through `@navar/retail`** (ADR-04, `ARCH-03`). No other package
  imports `@modelcontextprotocol/sdk`. The `RetailProvider` interface is the seam.
- **Deterministic code, never the LLM, owns:** allergen/restriction checks, budget arithmetic,
  every cart mutation, bonus/promo application, ingredient consolidation and unit conversion
  (ADR-02, `ARCH-01`). The LLM only interprets preferences, generates/adapts dishes, re-ranks
  ambiguous SKU candidates, and writes explanations.
- **The planner is a deterministic solver** — same inputs + same seed → same plan (ADR-03,
  `FR-PLAN-005`). Cost is computed in pack sizes, not grams. Promo SKUs are a solver _input_.
- **Goal mode is solver configuration, not a branch** (ADR-09). `routine` / `form` differ
  only by two optional hard constraints (protein floor, calorie corridor) and the soft-weight
  profile — both enter through `SolverInput`. No `if (goal === 'form')` below that; no
  `fitness` recipe tag — suitability is computed from macros + portion.
- **Food-safety guardrails are fail-closed** (ADR-05). See `.claude/rules/food-safety.md`.
- **MCP tokens are server-side only**, encrypted at rest in `mcp_credentials`, never in
  client code, never logged (`CON-02`, `NFR-SEC-001`).
- **Never mutate the cart without explicit in-session guest confirmation** (ADR-07,
  `FR-CART-002`); never clear an existing cart unprompted (`FR-CART-004`).

## Design reference

`designs/navar_design/` is an interactive pitch prototype built with Google AI Studio /
Gemini (Vite + React 19 + Tailwind v4). It is a **look-and-feel reference to borrow from,
not a source of truth** — it may not fully fit the real product. The TDD, SRS, and
`docs/mcp-audit-results.md` still win on behaviour and data shape.

- **What it is:** a sticky CSS phone frame (390×844) on the left, five scroll-linked
  narrative sections on the right, driven by IntersectionObserver. Ukrainian copy
  throughout. Its own nested git repo (`origin`: `maksymsavchenko95-svg/navar_design`),
  gitignored from this monorepo.
- **The five screens** map to the P0 flow: 1 Goal (`routine` / `form`) · 2 Numbers
  (protein floor + calorie corridor, ±15%) · 3 Tastes (receipt-informed, high-confidence
  defaults with easy removal) · 4 Plan (5-day menu, hero ₴ + protein + promo-savings,
  weekday rail, honest-constraint notice, dish cards, "Зібрати кошик" / "Дешевше на 300 ₴")
  · 5 Cart (SKU mapping, promo tags, out-of-stock replacement, loyalty-bonus toggle,
  handover to Silpo checkout).
- **Reuse selectively:** the design system in `src/index.css` (Silpo-orange → peach →
  borsch gradient palette as CSS custom properties, glassmorphism, Manrope) and the screen
  layouts inform `apps/web`. The phone-frame / mobile-screen parts are input for the **P1
  mobile clients**, not P0. Copy tone follows `.claude/rules/food-safety.md` scope limits
  (goal/preference framing, no medical/weight-loss language) — keep it that way when
  porting.
- All data in `src/mockData.ts` is mock. Wire real screens to the tRPC procedures in
  `docs/tdd-navar.md` §7.

## Commands

```bash
corepack enable && pnpm install
cp .env.example .env && cp apps/api/.env.example apps/api/.env && cp apps/web/.env.example apps/web/.env.local
# set MCP_TOKEN_KEY in .env and apps/api/.env:  openssl rand -base64 32

pnpm dev            # docker compose up: Postgres + api on :3001 (entrypoint runs migrations)
pnpm dev:web        # Next.js on :3000 (host)
pnpm dev:all        # both of the above

pnpm mcp:auth            # one-time Silpo OAuth → mcp_credentials (run on host; opens a browser)
pnpm mcp:tools-snapshot  # refresh docs/mcp-tools-snapshot.json (needs credentials)
pnpm mcp:audit           # M0 audit, blocks 0–5+7, read-only → docs/mcp-audit-raw/ (needs credentials)
pnpm mcp:audit:cart      # M0 audit block 6: cart write + idempotency (WRITES to the live cart, auto-cleans up)
pnpm db:generate         # drizzle-kit: regenerate SQL after editing packages/db/src/schema.ts
pnpm db:migrate          # apply migrations (also ensures the vector + pg_trgm extensions)
pnpm db:seed             # demo fixture: ingredients + recipes + one form-mode household
pnpm db:studio           # drizzle-kit studio

pnpm typecheck           # tsc across all packages
pnpm test                # vitest (packages/domain, packages/retail, apps/api). Run before calling a task done — see .claude/rules/testing.md
pnpm --filter @navar/domain test nutrition   # single vitest file by name filter
pnpm build          # tsc check + next build
pnpm format         # prettier --write . (also runs on every Claude edit via a hook)
```

Run the API on the host instead of in Docker: `docker compose up -d db` then
`pnpm --filter @navar/api dev` (uses `DATABASE_URL` from `apps/api/.env`, i.e. `localhost`).

## Rules

@.claude/rules/mcp-integration.md
@.claude/rules/food-safety.md
@.claude/rules/hackathon.md
@.claude/rules/testing.md
