import type { McpToolsResult } from "@navar/domain";

/**
 * `RetailProvider` — the seam that isolates the product from any single retailer
 * (ADR-04, `RISK-01`). Nothing outside this package speaks to the Silpo MCP; everything
 * else depends on this interface. It grows as features land (cart context, product
 * search, promotions, order history, writes); today it only lists tools.
 */
export interface RetailProvider {
  /** Connect if needed and return the tool catalogue (or an auth prompt). */
  listTools(): Promise<McpToolsResult>;
}
