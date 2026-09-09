import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ingredientCategorySchema } from "@navar/domain";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { buildQuery } from "./normalize-query.js";
import type { MapperDictEntry } from "./types.js";

/** Repo-root `data/golden` (this file is `packages/mapper/src/golden.ts`). */
export const GOLDEN_DIR = fileURLToPath(new URL("../../../data/golden", import.meta.url));

/**
 * One golden mapping pair (`NFR-MNT-003`, TDD §5). Without a committed catalogue snapshot,
 * an "expected SKU" is expressed as assertions on the normalised query (always checkable)
 * plus `acceptSkuKeywords` for a live hit-rate probe (`apps/api` `mapper:probe`).
 */
export const goldenPairSchema = z.object({
  slug: z.string(),
  expectQueryContains: z.array(z.string()).default([]),
  expectQueryExcludes: z.array(z.string()).default([]),
  expectCategory: ingredientCategorySchema.optional(),
  acceptSkuKeywords: z.array(z.string()).default([]),
  /** Substrings that must NOT appear in the chosen SKU name — wrong form / non-food (R7). */
  rejectSkuKeywords: z.array(z.string()).default([]),
});
export type GoldenPair = z.infer<typeof goldenPairSchema>;

export function loadGolden(dir: string = GOLDEN_DIR): GoldenPair[] {
  const raw = parseYaml(readFileSync(`${dir}/queries.yaml`, "utf8"));
  return z.array(goldenPairSchema).parse(raw);
}

export interface GoldenQueryOutcome {
  slug: string;
  query: string;
  queryPass: boolean;
  categoryPass: boolean;
}

/** Evaluate the query-side assertions of one pair against its dictionary entry. */
export function evaluateQuery(pair: GoldenPair, entry: MapperDictEntry): GoldenQueryOutcome {
  const query = buildQuery(entry);
  const queryPass =
    pair.expectQueryContains.every((s) => query.includes(s)) &&
    pair.expectQueryExcludes.every((s) => !query.includes(s));
  const categoryPass = pair.expectCategory == null || entry.category === pair.expectCategory;
  return { slug: pair.slug, query, queryPass, categoryPass };
}

/**
 * Evaluate the SKU-side assertions of one pair against a chosen SKU name (case-insensitive):
 * `acceptSkuKeywords` — at least one present; `rejectSkuKeywords` — none present (R7). For
 * the live hit-rate probe (`mapper:probe`). A missing SKU fails both.
 */
export function evaluateSkuMatch(
  pair: GoldenPair,
  skuName: string | null | undefined,
): { acceptPass: boolean; rejectPass: boolean } {
  const n = (skuName ?? "").toLowerCase();
  return {
    acceptPass:
      pair.acceptSkuKeywords.length === 0 ||
      pair.acceptSkuKeywords.some((k) => n.includes(k.toLowerCase())),
    // No SKU picked → nothing wrong was chosen; `acceptPass` still fails, so the probe
    // shows `acc?` (unresolved), not `❌rej` (a wrong pick).
    rejectPass: !pair.rejectSkuKeywords.some((k) => n.includes(k.toLowerCase())),
  };
}
