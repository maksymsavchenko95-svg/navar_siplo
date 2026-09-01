# Rule: Tests ship with the change

Spec: `docs/srs.md` §8.8 (`NFR-MNT-002/003`), `docs/tdd-navar.md` §10. Green tests are part
of "done" — a task is not finished until they exist and pass.

## Non-negotiables

1. **Every code change ships with test coverage in the same change.** New logic → new
   tests. Changed logic → updated tests. A bug you fixed → a test that would have caught it
   (the missing-`name` PII leak in the audit redactor is the canonical example).
2. **Run the full suite before declaring a task done** — `pnpm typecheck && pnpm test` —
   and **report the real result** (counts, any failures, anything skipped). Never claim
   "done" or "verified" without having run them in that turn.
3. **Make logic testable.** Pull pure functions out of scripts, entrypoints, and I/O
   wrappers into a plain module so they can be unit-tested without network, DB, or MCP
   (`apps/api/src/scripts/audit-util.ts` ↔ `audit-util.test.ts` is the pattern). Even
   one-shot audit / migration scripts follow this for their non-trivial helpers.
4. **Mandatory coverage** (`NFR-MNT-002`, ≥ 80 % on these): the solver, every safety
   guardrail, unit conversion, ingredient consolidation, pack/surplus math, cart-write
   idempotency, seeded determinism, kcal-floor enforcement (code **and** CHECK).
   `docs/tdd-navar.md` §10 lists the minimal set that must stay green.
5. **Determinism has a test.** Anything that must be reproducible (`FR-PLAN-005`, ADR-03)
   gets a same-seed-same-output test. Anything fail-closed gets a test for the closed path
   (missing data → rejected), not just the happy path.
6. **The golden mapping dataset** (`NFR-MNT-003`, ≥ 100 pairs by day 5, ≥ 300 target) runs
   on every mapper or prompt change — it is the only signal that a prompt edit helped.

## Where tests live

- Co-located `*.test.ts` next to the source, `vitest`. Follow the existing style in
  `packages/domain/src/*.test.ts` and `packages/retail/src/silpo/*.test.ts`.
- LLM steps: a golden test for the happy path **plus** the deterministic fallback exercised
  offline (`INT-LLM-003`).
- Run one file while iterating: `pnpm --filter <pkg> test <name-filter>`.

## Not required

Trivial one-line delegations, type-only changes, and generated files (`drizzle/*.sql`)
don't need a dedicated test — but say so explicitly rather than staying silent on coverage.
