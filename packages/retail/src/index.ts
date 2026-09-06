/**
 * @navar/retail — the MCP adapter and the `RetailProvider` seam (ADR-04). The only
 * package that imports `@modelcontextprotocol/sdk`.
 */
export {
  type HouseholdReader,
  type RetailProvider,
  NoCartError,
  AuthRequiredError,
} from "./provider.js";
export { toToolSummaries } from "./summaries.js";
export { isRateLimit } from "./silpo/errors.js";
export {
  runWithMcpTrace,
  recordMcpCall,
  recordCacheHit,
  summarizeArgs,
  currentTraceScope,
  type McpCallRecord,
  type McpCallEvent,
} from "./trace.js";
export {
  parseAddresses,
  parseFamily,
  parseFavorites,
  parseMyPromos,
  parseOrders,
  parseProfile,
  parsePromotions,
  parseRestrictionsRaw,
  toCartContext,
  toCartView,
  toCartWriteResult,
  toProductDetails,
  toProductSearchResults,
  toReplacementResults,
} from "./silpo/parse.js";
export { SilpoRetailProvider, type SilpoRetailProviderOptions } from "./silpo/adapter.js";
export { SilpoOAuthProvider, type SilpoOAuthOptions } from "./silpo/oauth.js";
export { runInteractiveAuth, type InteractiveAuthOptions } from "./silpo/auth-flow.js";
export {
  registerAppClient,
  resolveAppOAuthClient,
  type AppClientStore,
  type SilpoOAuthClient,
} from "./silpo/app-client.js";
export { beginWebLogin, finishWebLogin, type WebAuthOptions } from "./silpo/web-auth.js";
