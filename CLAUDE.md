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

**M0–M3 done, M4 in progress.** The end-to-end P0 loop works on a live Silpo account: web
login via Silpo OAuth → `household.bootstrap` reads profile/family/restrictions/receipts →
household portrait → deterministic 5-day meal plan in both goal modes (`routine` / `form`),
within budget, no restriction violated → persisted plan + SKU shopping list + a Guest-facing
explanation; an infeasible budget returns the nearest valid plan + the ₴ delta + a concrete
reason → cart preview/materialize → `validations[]` → balabonuses → `checkoutWebLink`. **M4:**
T4.1 (promo into the solver) + T4.2 (`plan.replaceItem` / `cheaper`) + T4.3 (`ops.trace` —
the MCP-call trace) done; T4.4 (web screens) in progress — the materialized-cart recovery
path (R4) is in: `cart.liveState` re-reads a materialized cart for its live `validations[]` +
per-line stock shortages, `cart.reduceLine` / post-materialize `cart.setLineSku` /
`plan.applyReplacement` edit a materialized plan and re-sync the Silpo cart in the same
operation (`apps/api/src/cart-resync.ts`). **T4.5 (latency) done** — cold `plan.generate`
68 s → ~10 s: the mapper's LLM SKU re-ranks run 8-wide (`mapWithConcurrency`) on
`NAVAR_LLM_RERANK_MODEL` (default `claude-haiku-4-5`), `explainPlan` is written in the
background, `buildPlanContext` reads are parallelised, and `getCartContext` shares one
in-flight fetch. Real progress stages via `apps/api/src/plan-progress.ts` (Redis) +
`plan.generationStage` (`plan.generate` stays a synchronous call — the BullMQ job is
deferred). T4.4 web screens + R0/R7 mapping quality next.
pnpm monorepo laid out per `docs/tdd-navar.md` §2.

| Path                           | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`              | `@navar/domain` — Zod schemas, inferred types, unit conversions, cross-package port contracts (`CredentialStore`). Depends only on zod. Imported by everything (ADR-01).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/db`                  | `@navar/db` — Drizzle schema + migrate + seed + the Postgres-backed `CredentialStore` (AES-256-GCM) + the idempotent `import-ingredients.ts` / `import-recipes.ts` importers (pure helpers split from DB I/O). The only package that touches the database.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `packages/retail`              | `@navar/retail` — `RetailProvider` seam + Silpo MCP adapter + OAuth (CLI loopback flow `auth-flow.ts` + web flow `web-auth.ts` + shared app-level DCR client `app-client.ts`). Typed methods: `listTools`, `getCartContext`, `findProducts`, `getProductDetails`, `getReplacements`, the `HouseholdReader` reads (`silpo/parse.ts` maps the raw responses); `rawToolList` / `callToolRaw` are audit-only. **The only package that imports `@modelcontextprotocol/sdk`** (ADR-04); a grep enforces it.                                                                                                                                                                                                                                                                                                                                              |
| `packages/planner`             | `@navar/planner` — the deterministic solver (TDD §4, ADR-03/09). `hardFilter` → `recipeCost` (in pack sizes; unmapped lines get a category-median estimate) → `scoreRecipe` (`WEIGHTS[goal]`) → `greedyPlan` day-by-day. Infeasible → `diagnoseInfeasible`: `cheapestPlan` + the binding constraint + a concrete reason (`FR-PLAN-006`). Portion-fit / local search still stubbed (T3.3).                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `packages/mapper`              | `@navar/mapper` — ingredient ↔ SKU matching (TDD §5, real). `consolidate` → `buildQuery` (head-noun normalisation) → `rankCandidates` (deterministic score) → LLM re-rank only on a close call → `decideMatch` (flags `confidence < 0.6`, never adds silently) → pack/surplus. Out-of-stock → replacement funnel. `data/golden/queries.yaml` regression set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/safety`              | `@navar/safety` — food-safety guardrails, deterministic + fail-closed (ADR-05). `resolveExclusions` (restrictions → EU-14 codes, non-canonical codes remapped + warned), `checkIngredient` (planning), `checkSku` (`get_product_details` — structured allergen tokens **and** a `Склад` free-text stem-scan), `needsSkuCheck` (narrow by category). Re-exports `assertKcalFloor` (`FR-SAFE-009`).                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/api`                     | Fastify + tRPC. Wires the packages; `/health`, `/auth/silpo/callback` (OAuth redirect → session), tRPC routers `auth` / `household` / `plan` / `recipes` (+ `hello`). `context.ts` resolves the session → `ctx.householdId` / per-household `ctx.retail`; `protectedProcedure` gates everything account-scoped. `src/{auth-flow,session,retail,mapper,plan,plan-edit,cart,cart-edit,cart-resync,mcp-trace,llm}.ts` + `household/` (bootstrap) + `queue/` (BullMQ). tRPC routers also include `cart` / `ops` (`ops.trace` = the T4.3 MCP-call trace). `cart-resync.ts` (R4) keeps `list_lines` ↔ the Silpo cart in lock-step for post-materialize edits. `src/scripts/{mcp-auth,mcp-register,mcp-tools-snapshot,mcp-audit,mcp-audit-cart,plan-probe,mapper-probe,cart-probe,plan-edit-probe,ops-trace}.ts` (`audit-util.ts` = tested pure helpers). |
| `apps/web`                     | Next.js (App Router). `providers.tsx` wraps the tree in `<SessionGate>` — no session → a «Ввійти з Сільпо» card; session → the app (`HelloCard`, `HouseholdPortrait`, `RecipesSection`) + a «Вийти» button. tRPC calls send `credentials: "include"`. Runs on the host.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `designs/navar_design/`        | Standalone Gemini / AI-Studio design prototype (Vite + React 19 + Tailwind v4; its own nested git repo; gitignored here). **Visual reference, not a spec** — see "Design reference" below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `docker-compose.yml`           | `db` (pgvector/pgvector:pg16, volume) + `redis` (7-alpine, `--appendonly`, volume — BullMQ + sessions + the cached DCR client) + `api`, all containerised. `web` runs on host.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `docs/tdd-navar.md`            | Phase-0 technical design **v0.2** (adds `routine`/`form` goal modes, nutrition, ADR-09): ADRs, schema, solver + mapping specs, 13-day plan. The build guide.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `docs/srs.md`                  | Requirements spec **v0.1** — behind the TDD. `FR-GOAL-*`, `FR-SAFE-009`, `ASM-06`, `RISK-09/10`, `Q-09` live in the TDD until the SRS is refreshed to v0.2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `docs/product-brief.md`        | Problem, market, differentiation, target user, metrics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `docs/mcp-reference.md`        | Silpo MCP reference: endpoint, OAuth flow, the tools, workflows (docs lag — the server returns 40, not 39).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `docs/mcp-audit-checklist.md`  | Day-1 manual audit of the live MCP → a decisions table. Run before building the solver.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `docs/mcp-audit-results.md`    | M0 audit output (2026-09-01): filled decisions table, trigger decisions, per-block findings, build follow-ups. Raw redacted responses under `docs/mcp-audit-raw/`. The M2 gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `docs/mcp-tools-snapshot.json` | Raw `tools/list` (full schemas), committed as the contract fixation. Regenerate: `pnpm mcp:tools-snapshot`. Reference only — never hardcode from it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `docs/hackathon-rules.md`      | Hackathon rules — background; `.claude/rules/hackathon.md` is the working checklist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `.claude/rules/`               | Standing engineering rules for all code (imported below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Workspace packages are consumed as **TypeScript source** (`exports` → `src/index.ts`).
`apps/web` lists `@navar/db` / `@navar/retail` / `@navar/llm` + `@fastify/cookie` as
devDependencies only so `tsc` can resolve the tRPC `AppRouter` context type (and its cookie
augmentation) — they are never bundled (client imports are `import type`).

## Target stack (`docs/srs.md` §4.2, `docs/tdd-navar.md` §1)

In use: TypeScript (Node 22) pnpm monorepo · Fastify + tRPC + Zod + `@fastify/cookie` ·
PostgreSQL 16 + pgvector + pg_trgm · Drizzle ORM · `@modelcontextprotocol/sdk`
(StreamableHTTP) · BullMQ + Redis (bootstrap job + sessions) · Langfuse (LLM traces, opt-in)
· Next.js (App Router) · Docker Compose.

Still deferred (introduce when a feature needs it): OpenTelemetry + Sentry (the T4.3
`mcp_call_log` + `ops.trace` MCP-call trace ships without them); the pantry / plan-outcome
tables (`docs/tdd-navar.md` §3); the web plan / cart / onboarding screens (T4.4); account
deletion + household invites (`FR-AUTH-004/006`, P1).

Runtime is `tsx` (dev and prod). `pnpm build` / `pnpm typecheck` run `tsc` as a check only —
no JS emit.

## Data model

`packages/db/src/schema.ts` — the identity + consumption + recipe-corpus + plan subset of
`docs/tdd-navar.md` §3: `households` (incl. `goal` = routine|form, `bootstrap_status`, the
**unique `silpo_user_ref`** — one row per Silpo account, the login dedup key),
`household_members`, `household_restrictions`, `nutrition_targets`, `consumption_models`,
`household_preferences`, `receipt_lines`, `mcp_credentials`, `canonical_ingredients`,
`recipes`, `recipe_ingredients`, `plans` / `plan_items` / `list_lines` (T2.4 — migration
`0005`; TDD §3's `text` FK types are stale, real ones are `uuid`; `plan_items.recipe_id`
is nullable + `ON DELETE SET NULL` since `import-recipes.ts` prunes), and `mcp_call_log`
(T4.3 — migration `0008`, the `ops.trace` MCP-call trace, `plan_id`-scoped + best-effort
writes). IDs are `uuid` + a separate unique `slug`; `list_lines` / `receipt_lines` /
`mcp_call_log` are the `bigserial` fact tables.
MCP tokens are AES-256-GCM ciphertext in `mcp_credentials.payload`, scoped per household
(`NFR-SEC-001`). **System sessions are in Redis** (`navar:sess:<id>` → `{householdId}`,
`apps/api/src/session.ts`), not Postgres — the client holds only an opaque `navar_sid`
cookie, never the Silpo token (`FR-AUTH-002`).

`receipt_lines` holds the raw purchased lines from `silpo_get_my_*_orders`, written by
`household.bootstrap` via `saveReceiptLines` (`@navar/db`) — delete-by-household + insert,
with a best-effort deterministic `ingredient_id` link (`receipt-lines.ts` phrase-matches
`raw_name` against the dictionary; brand-heavy items stay null for the T2.1 mapper).

Nutrition (`form` mode): `canonical_ingredients` and `recipes` carry per-100 g / per-serving
macros; recipe macros are **computed from the ingredients on import**, never hand-set (like
the allergen union). `nutrition_targets.kcal_target` has a DB `CHECK (>= 1200)` — the
`FR-SAFE-009` calorie floor, also enforced in `assertKcalFloor` and `nutritionTargetsSchema`.

Edit the schema, then `pnpm db:generate` to regenerate SQL under `packages/db/drizzle/`.
`pnpm db:seed` is non-destructive — it upserts a demo household on `silpo_user_ref='demo'`
(a **script-only** fixture for `plan:probe` / `mapper:probe` / the integration tests; web
users log in fresh via Silpo OAuth and get their own household). It runs
`import-ingredients.ts` then `import-recipes.ts`; both upsert on `slug` and never truncate.
Note: some `apps/api` integration tests need a fresh `pnpm db:seed` first — an interrupted
run can leave the demo household without its restrictions.

The recipe corpus is `data/recipes/*.yaml` in git (`FR-RECIPE-001..005`, TDD §2 — "import is
a build step"). `import-recipes.ts` validates each file against `recipeSeedSchema`, then
**computes** the allergen union and per-serving macros from the ingredient dictionary
(`recipeMacros`) — never hand-set. `pnpm db:import:recipes` imports standalone; a bad YAML
aborts with the filename, and `packages/db/src/recipes-corpus.test.ts` fails the build for it.

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
  client code, never logged (`CON-02`, `NFR-SEC-001`). The web client authenticates via
  Silpo OAuth and holds only an opaque `navar_sid` session cookie (`FR-AUTH-002`).
- **Every account-scoped request runs against the session's household.** Use
  `protectedProcedure` + `ctx.householdId` / `ctx.retail` (per-household provider) — never a
  process-wide "current household". `resolveHouseholdId()` survives only as a CLI-script helper.
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
# in .env and apps/api/.env, `openssl rand -base64 32` into:  MCP_TOKEN_KEY  and  COOKIE_SECRET

pnpm dev            # docker compose up: Postgres + Redis + api on :3001 (entrypoint runs migrations)
pnpm dev:web        # Next.js on :3000 (host) — open it and log in with «Ввійти з Сільпо»
pnpm dev:all        # both of the above

pnpm mcp:register        # one-time: DCR the shared Silpo OAuth client → pin as SILPO_OAUTH_CLIENT (else lazily cached in Redis)
pnpm mcp:auth            # CLI/script Silpo OAuth (loopback) → mcp_credentials for the demo household; web users log in via the browser
pnpm mcp:tools-snapshot  # refresh docs/mcp-tools-snapshot.json (needs credentials)
pnpm --filter @navar/api plan:probe    # console demo: household → deterministic 5-day plan (--goal routine|form --budget N --seed N [--persist])
pnpm --filter @navar/api mapper:probe  # live SKU hit-rate + golden query assertions
pnpm mcp:audit           # M0 audit, blocks 0–5+7, read-only → docs/mcp-audit-raw/ (needs credentials)
pnpm mcp:audit:cart      # M0 audit block 6: cart write + idempotency (WRITES to the live cart, auto-cleans up)
pnpm db:generate         # drizzle-kit: regenerate SQL after editing packages/db/src/schema.ts
pnpm db:migrate          # apply migrations (also ensures the vector + pg_trgm extensions)
pnpm db:import:ingredients # idempotent upsert of the CanonicalIngredient dictionary
pnpm db:import:recipes    # idempotent upsert of data/recipes/*.yaml (allergens + macros computed)
pnpm db:seed             # demo fixture: ingredients + recipes + one form-mode household (script/test only)
pnpm db:studio           # drizzle-kit studio

pnpm typecheck           # tsc across all packages
pnpm test                # vitest, all packages (api + db run serially — shared DB). DB/Redis-gated suites need `docker compose up -d db redis` + a fresh seed. Run before calling a task done — see .claude/rules/testing.md
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
