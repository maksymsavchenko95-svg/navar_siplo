import { closeDb, db } from "@navar/db";
import { mapPlan, type PlanIngredientLine } from "@navar/mapper";
import { hasHardExclusion } from "@navar/safety";

import { resolveHouseholdId } from "../household.js";
import {
  getRerankFn,
  loadExclusions,
  loadMapperDict,
  makeIngredientSafety,
  makeSkuSafety,
} from "../mapper.js";
import { getSilpoProvider } from "../retail.js";

/**
 * `pnpm --filter @navar/api mapper:probe [recipeSlug ...]` — runs `@navar/mapper` against
 * the live Silpo MCP for a small multi-recipe plan and prints the mapping table + hit-rate
 * vs the 85% bar (`AC-P0-05`), plus the T2.2 safety gate for the resolved household
 * (`AC-P0-07`). Needs `pnpm mcp:auth` done first.
 *
 * Not a runtime path — a manual verification artefact.
 */
const DEFAULT_SLUGS = ["borshch", "buckwheat_mushrooms", "beef_stroganoff", "egg_spinach_omelette"];

async function main(): Promise<void> {
  const slugs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_SLUGS;

  const recipes = await db.query.recipes.findMany({
    where: (r, { inArray }) => inArray(r.slug, slugs),
    with: { ingredients: { with: { ingredient: true } } },
  });
  if (recipes.length === 0) {
    console.error(`no recipes matched: ${slugs.join(", ")} — try slugs from \`pnpm db:seed\``);
    process.exitCode = 1;
    return;
  }
  console.log(`plan: ${recipes.map((r) => r.slug).join(", ")}`);

  const lines: PlanIngredientLine[] = recipes.flatMap((r) =>
    r.ingredients.map((ri) => ({
      slug: ri.ingredient.slug,
      amount: Number(ri.amount),
      unit: ri.unit as PlanIngredientLine["unit"],
      optional: ri.optional,
    })),
  );

  const dict = await loadMapperDict([...new Set(lines.map((l) => l.slug))]);
  const silpo = await getSilpoProvider();

  const householdId = await resolveHouseholdId();
  const exclusions = householdId
    ? await loadExclusions(householdId)
    : { allergens: [], ingredients: [], strictMode: false };
  if (hasHardExclusion(exclusions)) {
    console.log(
      `exclusions: allergens=[${exclusions.allergens.join(",")}] ingredients=[${exclusions.ingredients.join(",")}]`,
    );
  }

  const result = await mapPlan(
    { lines, dict },
    {
      retail: silpo,
      rerank: getRerankFn(),
      ...(hasHardExclusion(exclusions)
        ? {
            ingredientSafety: makeIngredientSafety(exclusions),
            skuSafety: makeSkuSafety(silpo, exclusions, householdId!),
          }
        : {}),
    },
  );

  console.log(`\nbranch ${result.branchId || "—"}\n`);
  const col = (s: string, n: number) => s.slice(0, n).padEnd(n);
  console.log(
    col("ingredient", 22),
    col("query", 20),
    col("SKU", 34),
    col("pack", 10),
    col("conf", 6),
    "decision",
  );
  for (const m of result.matches) {
    console.log(
      col(m.ingredientNameUk, 22),
      col(m.query, 20),
      col(
        m.decision === "blocked_unsafe" ? (m.blockReason ?? "заблоковано") : (m.match?.name ?? "—"),
        34,
      ),
      col(m.match ? `${m.packCount}×${m.packSize ?? "?"}` : "—", 10),
      col(m.confidence.toFixed(2), 6),
      m.decision,
    );
  }

  const { total, matched, needsConfirmation, noMatch, blocked } = result.stats;
  const pct = total ? Math.round((matched / total) * 100) : 0;
  console.log(
    `\n${matched}/${total} matched (${pct}%) · ${needsConfirmation} need confirmation · ` +
      `${noMatch} no match · ${blocked} blocked (safety)`,
  );
  console.log(pct >= 85 ? "✅ at or above the 85% AC-P0-05 bar" : "⚠️  below the 85% AC-P0-05 bar");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
