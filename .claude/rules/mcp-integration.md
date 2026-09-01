# Rule: Silpo MCP integration

Full tool catalog and workflows: `docs/mcp-reference.md`. This file is the set of
non-negotiable engineering rules for talking to the MCP.

## Contract snapshot

`docs/mcp-tools-snapshot.json` is the committed raw `tools/list` (full schemas), the day-1
contract fixation (`docs/mcp-audit-checklist.md` Block 0). Regenerate with
`pnpm mcp:tools-snapshot`. It is a reference for humans — **never** a source to hardcode
tool names or schemas from; always call `tools/list` live at worker start (`INT-MCP-001`).
The reference docs lag reality (the server returns 40 tools, the docs say 39).

## Connection

- Endpoint `https://mcp.silpo.ua/mcp`, transport Streamable HTTP, auth OAuth 2.1 +
  PKCE. Official server only — no third-party/scraped Silpo APIs (`CON-01`).
- Call `tools/list` at the start of every worker and validate that the critical tools
  exist. **Never hardcode tool names or schemas** from the docs — the server is the
  source of truth (`INT-MCP-001`).
- Tokens (access + refresh) live server-side in `mcp_credentials`, AES-256-GCM encrypted
  at rest, per household, never sent to clients, never written to logs (`CON-02`,
  `NFR-SEC-001/002`).

## Every access goes through `@navar/retail`

No package outside `packages/retail` imports `@modelcontextprotocol/sdk` or calls MCP
(`ARCH-03`, ADR-04) — a grep enforces it. `RetailProvider` is the seam that keeps a
second retailer possible (`INT-MCP-004`, `RISK-01`).

## Cart context is a prerequisite

Most search/catalog tools are gated on cart context. Establish it first, in order:

```
silpo_get_my_shopping_cart      → cartId
silpo_get_shopping_cart_by_id   → branchId, deliveryType, timeslot
silpo_get_time_slots            → validate the slot (mandatory)
```

## Writes

- Write tools: `silpo_add_or_update_cart_products`, `silpo_remove_cart_products`,
  `silpo_clear_shopping_cart`, `silpo_update_shopping_cart`,
  `silpo_add_or_update_certificates`, `silpo_add_or_update_favorite_products`.
- Every write goes through a separate path with **explicit guest confirmation** and
  **idempotency keyed on the plan** — a retry must not duplicate items
  (`INT-MCP-003`, `NFR-REL-003`).
- **After any write, re-read the cart** (`silpo_get_shopping_cart_by_id`) and inspect
  `validations[]`. Never assume success (`FR-CART-005`).
- Do not clear or overwrite an existing cart without an explicit guest request
  (`FR-CART-004`).

## Error handling (`INT-MCP-002`)

| Code                      | Handling                                                                        |
| ------------------------- | ------------------------------------------------------------------------------- |
| `401 invalid_token`       | Refresh token; on failure move guest to "reconnect needed" without losing plans |
| `403`                     | Do not retry. Degrade the scenario gracefully with an explanation               |
| `429`                     | Exponential backoff + queue. Limits are per-user                                |
| `-32601 Method not found` | Fall back, alert; re-check `tools/list`                                         |

MCP being unavailable must not lose data: plans persist, materialization is queued with
retry (`NFR-REL-002`).

## Observability

Every MCP call is logged — tool name, duration, status, correlation ID — and the trace
is exportable (`FR-OPS-001`). The demo must _show_ JSON-RPC calls happening; build this
in from the first commit, not at the end.

## Data minimization before the LLM

Strip phone, email, exact address, loyalty card number before sending anything to the
model (`INT-LLM-004`).

## Rate-limit budget

`silpo_find_products_batch` takes up to 30 items per call. Assume a plan needs 2–3 batch
calls; batch, cache (`ingredient + branch → SKU`, short TTL; never cache prices/stock
beyond 60 min), and run sequentially with backoff (`FR-MAP-004`, `NFR-DATA-002`).
