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
export {
  parseAddresses,
  parseFamily,
  parseFavorites,
  parseOrders,
  parseProfile,
  parseRestrictionsRaw,
  toCartContext,
  toProductDetails,
  toProductSearchResults,
  toReplacementResults,
} from "./silpo/parse.js";
export { SilpoRetailProvider, type SilpoRetailProviderOptions } from "./silpo/adapter.js";
export { SilpoOAuthProvider } from "./silpo/oauth.js";
export { runInteractiveAuth, type InteractiveAuthOptions } from "./silpo/auth-flow.js";
