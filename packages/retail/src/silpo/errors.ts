/**
 * True when an error is the Silpo cart-write rate limit. The server sends this as a
 * plain-text message ("Rate limit exceeded"), **not** a JSON-RPC 429, so the adapter's
 * `withBackoff` (which matches `err.code === 429`) does not catch it — the write path
 * (`writeWithRetry`) uses this instead. Kept dependency-free so scripts can share it.
 */
export function isRateLimit(err: unknown): boolean {
  const e = err as { code?: number; message?: string };
  if (e.code === 429) return true;
  return /rate limit/i.test(e.message ?? String(err));
}
