/**
 * Bounded-concurrency map (T4.5). Runs `fn` over `items` with at most `limit` in flight,
 * returning results **in input order**. Used for the mapper's LLM re-ranks, which are
 * independent per ingredient — running them 8-wide instead of one at a time is the single
 * biggest cut to `plan.generate` wall-clock, and cannot change the outcome because each
 * call's input is one ingredient's candidate list.
 *
 * `fn` is expected not to throw (the `RerankFn` contract) — a rejection propagates and
 * aborts the batch, matching `Promise.all`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const width = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
