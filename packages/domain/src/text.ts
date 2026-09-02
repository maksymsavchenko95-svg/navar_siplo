/**
 * Text normalisation + trigram similarity — deterministic, pure, zod-free. Lives in
 * `@navar/domain` so `@navar/mapper` can score SKU-name strings without pulling `pg` /
 * drizzle for string work (T2.1, TDD §5).
 *
 * `normalizeText` is the same intent as `@navar/db`'s `normalizeName` (`receipt-lines.ts`);
 * the duplication is deliberate for now — a follow-up should make `@navar/db` delegate
 * here. `receipt-lines.ts` is left untouched to keep T2.1 scoped.
 *
 * ── Divergence from Postgres `pg_trgm` ────────────────────────────────────────
 * `trigrams` approximates `show_trgm`: it lowercases, keeps only Unicode letters (so
 * digits and `%` are dropped, where pg keeps alphanumerics), pads each word `"  word "`
 * and emits every 3-char window. It does NOT replicate pg's exact word-boundary blank
 * handling, and strings are iterated as JS UTF-16 code units (fine for BMP Cyrillic).
 * This is acceptable because the DB trgm index is never consulted on the mapper's path —
 * the function only needs to rank SKU-name strings consistently, which a determinism test
 * pins.
 */

/**
 * Lowercase, drop every apostrophe variant, fold `ё→е`, keep only Unicode letters and
 * spaces (strips brand quotes «», digits, `%`, units, punctuation), collapse whitespace.
 */
export function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[ʼ'`’‘]/g, "")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The pg_trgm-style trigram set of `s`: normalise, then for each word emit every length-3
 * window of `"  " + word + " "`. Deduplicated. An empty / letterless string → empty set.
 */
export function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  const normalized = normalizeText(s);
  if (!normalized) return out;
  for (const word of normalized.split(" ")) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) {
      out.add(padded.slice(i, i + 3));
    }
  }
  return out;
}

/**
 * Jaccard similarity of the two trigram sets: `|A ∩ B| / |A ∪ B|`, in `[0, 1]`, symmetric.
 * Two empty strings → `1`; anything vs an empty string → `0`.
 */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return intersection / union;
}
