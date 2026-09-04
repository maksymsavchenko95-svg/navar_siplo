import { closeDb, getPlanDetail } from "@navar/db";
import type { Goal } from "@navar/domain";

import {
  applyBonus,
  checkoutLink,
  materializePlan,
  offerBonus,
  partitionPlanLines,
  previewPlan,
  toCartWriteItems,
} from "../cart.js";
import { resolveHouseholdId } from "../household.js";
import { generateAndPersistPlan } from "../plan.js";
import { getRetail } from "../retail.js";

/**
 * `pnpm --filter @navar/api cart:probe [--household <id>] [--plan <id> |
 *   --generate [--goal g] [--budget N]] [--confirm-all] [--bonus] [--no-cleanup]`
 *
 * `--household` overrides the default (seeded demo, else oldest) — use it to target a
 * real logged-in account rather than the `form`/gluten demo fixture.
 *
 * Demo-2 console command (`AC-P0-06`, `AC-P0-08`): a persisted plan → `cart.preview` →
 * `cart.materialize` against the **live** Silpo cart → `validations[]` + `checkoutWebLink` +
 * the plan-estimate vs real-cart-total delta. `--bonus` also offers + applies balabonuses
 * (T3.2). Unless `--no-cleanup`, everything it added is removed at the end (never touches
 * pre-existing lines). Needs `pnpm mcp:auth`.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const col = (s: string, n: number): string => s.slice(0, n).padEnd(n);

async function main(): Promise<void> {
  const householdId = arg("household") ?? (await resolveHouseholdId());
  if (!householdId) {
    console.error("no household — run pnpm db:seed (or pass --household <id>)");
    process.exitCode = 1;
    return;
  }
  console.log(`household ${householdId}`);
  const retail = getRetail(householdId);

  let planId = arg("plan");
  if (!planId && flag("generate")) {
    const gen = await generateAndPersistPlan(householdId, retail, {
      goal: arg("goal") as Goal | undefined,
      budgetUah: arg("budget") ? Number(arg("budget")) : undefined,
    });
    if (gen.status !== "ok") {
      console.log(`⚠️  plan.generate → ${gen.status}${"reason" in gen ? ` — ${gen.reason}` : ""}`);
      process.exitCode = 1;
      return;
    }
    planId = gen.planId;
    console.log(`generated plan ${planId}`);
  }
  if (!planId) {
    console.error("pass --plan <id> or --generate");
    process.exitCode = 1;
    return;
  }

  // ── preview ───────────────────────────────────────────────────────────────
  const preview = await previewPlan(planId, householdId, retail);
  if (preview.status !== "ok") {
    console.log(`⚠️  cart.preview → ${preview.status}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `\npreview · addable ${preview.addable.length} · needs-confirm ${preview.needsConfirmation.length} ` +
      `· blocked ${preview.blocked.length} · out-of-stock ${preview.outOfStock.length} · unmatched ${preview.unmatched.length}`,
  );
  console.log(
    `estimated add: ${preview.estimatedAddUah} ₴ · current cart lines: ${preview.currentCartLines}`,
  );
  for (const l of preview.addable) {
    console.log(
      `  + ${col(l.nameUk, 26)} ${col(l.productName ?? "?", 34)} ×${l.quantity} ${l.priceUah ?? "?"}₴`,
    );
  }
  for (const l of [
    ...preview.blocked,
    ...preview.needsConfirmation,
    ...preview.outOfStock,
    ...preview.unmatched,
  ]) {
    console.log(
      `  ! ${col(l.nameUk, 26)} ${l.decision ?? "-"}${l.blockReason ? ` — ${l.blockReason}` : ""}`,
    );
  }

  // ── materialize ──────────────────────────────────────────────────────────
  const plan = await getPlanDetail(planId, householdId);
  const part = plan ? partitionPlanLines(plan.list) : null;
  const confirmedLines =
    flag("confirm-all") && part ? part.needsConfirmation.map((l) => l.slug) : [];
  const addedItems =
    part && plan
      ? toCartWriteItems([
          ...part.addable,
          ...part.needsConfirmation.filter((l) => confirmedLines.includes(l.slug)),
        ])
      : [];

  console.log("\n── materialize ──");
  const mat = await materializePlan(planId, householdId, retail, {
    skipPreviewGuard: true,
    confirmedLines,
  });
  if (mat.status !== "ok") {
    console.log(
      `⚠️  cart.materialize → ${mat.status}${"message" in mat ? ` — ${mat.message}` : ""}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`added ${mat.addedCount} · skipped ${mat.skipped.length}`);
  for (const s of mat.skipped) console.log(`  skip ${col(s.nameUk, 26)} — ${s.reason}`);
  console.log("validations:");
  for (const v of mat.validations)
    console.log(`  [${v.level}] ${v.message} ${JSON.stringify(v.context ?? {})}`);
  console.log(
    `plan estimate ${mat.planEstimateUah ?? "?"} ₴  vs  cart total ${mat.cartTotalUah ?? "?"} ₴` +
      (mat.planEstimateUah && mat.cartTotalUah
        ? `  (Δ ${(((mat.cartTotalUah - mat.planEstimateUah) / mat.planEstimateUah) * 100).toFixed(1)}%)`
        : ""),
  );
  console.log(
    mat.totalsWithinTolerance == null
      ? "NFR-DATA-003: — N/A (skipped lines or a non-empty starting cart)"
      : mat.totalsWithinTolerance
        ? "NFR-DATA-003: ✅ within tolerance (≤3%)"
        : "NFR-DATA-003: ⚠️ exceeded (>3%)",
  );
  console.log(`checkoutWebLink: ${mat.checkoutWebLink ?? "— (cart fails validation)"}`);

  const link = await checkoutLink(planId, householdId, retail);
  console.log(
    `cart.checkoutLink → ${link.status}${link.status === "unavailable" ? ` (${link.reason})` : ""}`,
  );

  // ── balabonuses (T3.2) ───────────────────────────────────────────────────
  if (flag("bonus")) {
    console.log("\n── balabonuses ──");
    const offer = await offerBonus(planId, householdId, retail);
    console.log(`offer → ${JSON.stringify(offer)}`);
    if (offer.status === "ok" && offer.isEnabled && offer.available > 0) {
      const applied = await applyBonus(planId, householdId, retail, offer.available);
      console.log(`apply(${offer.available}) → ${JSON.stringify(applied)}`);
      // put it back so the probe leaves no trace
      await applyBonus(planId, householdId, retail, null);
    }
  }

  // ── cleanup ──────────────────────────────────────────────────────────────
  if (flag("no-cleanup")) {
    console.log(`\n(left ${addedItems.length} items in the cart — --no-cleanup)`);
  } else if (addedItems.length > 0) {
    const removed = await retail.removeCartProducts(addedItems.map((i) => i.productId));
    console.log(`\ncleanup: removed ${removed.products.length} items — cart back to baseline`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
