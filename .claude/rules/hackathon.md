# Rule: Hackathon constraints & acceptance

Navar's first milestone is a submission to the **Silpo AI Factory** hackathon. Full rules:
`docs/hackathon-rules.md`. Submission: video pitch (YouTube) + demo by **14 Sep 2026**;
live final for the top 10 on **30 Sep 2026**. This file is the working checklist —
optimize P0 work against it.

## Eligibility (hard — a project that misses any of these is ineligible)

- Connects to the official `https://mcp.silpo.ua/mcp` only.
- At least one real MCP tool call happens inside the working agent scenario.
- That call is **visible** in the demo (screen recording, JSON-RPC log, or trace).
- Tokens are server-side, never in front-end code.

## Judging weights — the optimization target

| Weight | Criterion                                                                                  |
| ------ | ------------------------------------------------------------------------------------------ |
| 25%    | Innovativeness — novelty, differentiation from what exists                                 |
| 25%    | Impact on the Guest or business — problem, audience, value, measurability                  |
| 20%    | Feasibility — technical, operational, economic, legal; integration realism                 |
| 15%    | Technical substance — architecture, AI justification, MCP usage, agency, prototype quality |
| 15%    | Presentation quality — clarity of problem, solution, demo                                  |

Use the word **"Guest"** (Гість) for the customer, in the pitch and user-facing copy.

## The Mushroom Gennadiyovych constraint

Silpo already ships an in-app AI assistant ("Машрум Геннадійович"): product picking,
dish ideas, recipes, photo-list → cart. "One more chat assistant" scores badly on
Innovativeness. Navar's answer: what the agent _does_, not what it advises — weekly cycle,
budget as a hard constraint, receipt-derived consumption model, remainder loop. Keep demos
and copy pointed at that.

## Phase 0 acceptance (`docs/srs.md` §9) — the demo must show, on a live account:

1. Connection via the official MCP OAuth flow; token stays on the backend.
2. Profile + family + restrictions + receipt history read → household portrait shown.
3. A 5-day plan that fits the given budget and violates no restriction.
4. ≥30% of plan cost on promo / personal-promo items, shown to the Guest as a number.
5. Plan materialized into a real cart; ≥85% of items mapped without manual intervention.
6. Discrepancies + `validations[]` shown, balabonuses offered, working `checkoutWebLink`.
7. A guardrail demonstrated: an allergen item blocked with an explanation.
8. The JSON-RPC MCP call trace is visible.
9. Re-running with the same seed produces the same plan.
10. Validation results: ≥8 interviews + wizard-of-oz on 10 real plans.

**Deliberately out of P0:** mobile clients, push cycle, pantry, offline list, chat
correction, multi-profile, nutrient tracking.

## Recommended pitch order

`Problem → User → Solution → Agent flow → MCP → Demo → Value → Metrics`
