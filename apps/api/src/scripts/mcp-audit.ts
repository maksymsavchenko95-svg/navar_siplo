import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { closeDb } from "@navar/db";

import { getSilpoProvider } from "../retail.js";
import { errMsg, redact, shape } from "./audit-util.js";

/**
 * `pnpm mcp:audit` — drives the MCP audit checklist (`docs/mcp-audit-checklist.md`)
 * Blocks 0–5 + 7 read-only against the live Silpo MCP using the stored credentials.
 * Writes redacted raw responses to `docs/mcp-audit-raw/*.json` and prints a summary to
 * fill `docs/mcp-audit-results.md`. Block 6 (cart writes) is deliberately NOT here.
 *
 * Not a runtime path — uses `SilpoRetailProvider.callToolRaw` (audit seam).
 */
const RAW_DIR = fileURLToPath(new URL("../../../../docs/mcp-audit-raw/", import.meta.url));

const results: Record<string, unknown> = {};

async function dump(name: string, value: unknown): Promise<void> {
  await writeFile(`${RAW_DIR}${name}.json`, JSON.stringify(redact(value), null, 2) + "\n", "utf8");
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    const out = await fn();
    console.log(`  ${label}: ${Date.now() - t0} ms`);
    return out;
  } catch (err) {
    console.log(`  ${label}: FAILED after ${Date.now() - t0} ms — ${errMsg(err)}`);
    throw err;
  }
}

async function main(): Promise<void> {
  await mkdir(RAW_DIR, { recursive: true });
  const silpo = await getSilpoProvider();

  // ── Block 0 — inventory ────────────────────────────────────────────────────
  console.log("\n── Block 0 — inventory");
  const rawTools = (await silpo.rawToolList()) as {
    tools: { name: string; description?: string }[];
  };
  const toolNames = rawTools.tools.map((t) => t.name).sort();
  console.log(`  live tools/list: ${toolNames.length}`);
  await dump("block0-tools", toolNames);
  results.block0 = { toolCount: toolNames.length, toolNames };

  // ── Cart context (prerequisite for gated tools) ────────────────────────────
  console.log("\n── Cart context");
  const myCart = (await timed("get_my_shopping_cart", () =>
    silpo.callToolRaw("silpo_get_my_shopping_cart"),
  )) as { exists?: boolean; shoppingCartId?: string };
  await dump("cart-my", myCart);
  if (myCart.exists === false || !myCart.shoppingCartId) {
    console.log("  exists=false — guest has no cart. Gated blocks (1,2,4,5) will be skipped.");
    results.cartContext = { exists: false };
  }
  let ctx: {
    branchId?: string;
    deliveryType?: string;
    timeslotStart?: string;
    timeslotEnd?: string;
  } = {};
  if (myCart.shoppingCartId) {
    const byId = (await timed("get_shopping_cart_by_id", () =>
      silpo.callToolRaw("silpo_get_shopping_cart_by_id", { shoppingCartId: myCart.shoppingCartId }),
    )) as {
      cart?: {
        deliveryType?: string;
        timeslot?: { start?: string; end?: string };
        shipments?: { branchId?: string }[];
        loyalty?: unknown;
        validations?: unknown;
        checkoutWebLink?: string;
      };
    };
    await dump("cart-by-id", byId);
    const branchId = byId.cart?.shipments?.[0]?.branchId;
    const deliveryType = byId.cart?.deliveryType;
    results.cartContext = {
      exists: true,
      branchId,
      deliveryType,
      cartTimeslot: byId.cart?.timeslot,
      hasLoyaltyField: byId.cart?.loyalty !== undefined,
      loyaltyShape: shape(byId.cart?.loyalty),
      validationsShape: shape(byId.cart?.validations),
      hasCheckoutWebLink: Boolean(byId.cart?.checkoutWebLink),
    };
    if (branchId && deliveryType) {
      const slots = (await timed("get_time_slots", () =>
        silpo.callToolRaw("silpo_get_time_slots", {
          branchId,
          deliveryTypes: [deliveryType],
          limit: 25,
        }),
      )) as { slots?: { start?: string; end?: string; available?: boolean }[] };
      await dump("cart-timeslots", slots);
      const slot = (slots.slots ?? []).find((s) => s.available) ?? (slots.slots ?? [])[0];
      ctx = {
        branchId,
        deliveryType,
        timeslotStart: slot?.start,
        timeslotEnd: slot?.end,
      };
      console.log(
        `  branchId=${branchId} deliveryType=${deliveryType} slot=${slot?.start ?? "none"}`,
      );
    }
  }
  const gated = Boolean(ctx.branchId && ctx.timeslotStart);

  // ── Block 1 — offline / online orders ──────────────────────────────────────
  console.log("\n── Block 1 — orders (ASM-01, Q-01)");
  if (gated) {
    const offlinePages: unknown[] = [];
    for (const offset of [0, 10, 20, 30, 40, 50]) {
      try {
        const page = (await timed(`offline_orders offset=${offset}`, () =>
          silpo.callToolRaw("silpo_get_my_offline_orders", {
            branchId: ctx.branchId,
            deliveryType: ctx.deliveryType,
            timeslotStart: ctx.timeslotStart,
            timeslotEnd: ctx.timeslotEnd,
            limit: 10,
            offset,
          }),
        )) as { orders?: unknown[] };
        offlinePages.push(page);
        if (!page.orders || page.orders.length === 0) break;
      } catch (err) {
        offlinePages.push({ offset, error: errMsg(err) });
        break;
      }
    }
    await dump("block1-offline-orders", offlinePages);
    const allOrders = offlinePages.flatMap((p) => (p as { orders?: unknown[] }).orders ?? []);
    results.block1 = {
      offline: {
        pagesFetched: offlinePages.length,
        totalOrders: allOrders.length,
        oneOrderShape: shape(allOrders[0]),
      },
    };
  } else {
    console.log("  skipped — no cart context");
    results.block1 = { skipped: "no cart context" };
  }
  try {
    const online = (await timed("online_orders limit=100", () =>
      silpo.callToolRaw("silpo_get_my_online_orders", { limit: 100 }),
    )) as { orders?: unknown[] };
    await dump("block1-online-orders", online);
    (results.block1 as Record<string, unknown>).online = {
      totalOrders: online.orders?.length ?? 0,
      oneOrderShape: shape(online.orders?.[0]),
    };
  } catch (err) {
    (results.block1 as Record<string, unknown>).online = { error: errMsg(err) };
  }

  // ── Block 2 — product_details: composition + nutrients ─────────────────────
  console.log("\n── Block 2 — product_details (ASM-02, Q-02)");
  const PROBES = [
    "молоко Селянське",
    "куряче філе охолоджене",
    "банан",
    "гречка ядриця",
    "олія соняшникова",
    "хліб житній",
    "яйця курячі С0",
    "сир кисломолочний",
    "яблуко",
    "яловичина",
    "цукор",
    "макарони",
  ];
  if (gated) {
    let found: { queries?: { query?: string; products?: { slug?: string; title?: string }[] }[] } =
      {};
    try {
      found = (await timed("find_products_batch (12 probes)", () =>
        silpo.callToolRaw("silpo_find_products_batch", {
          branchId: ctx.branchId,
          deliveryType: ctx.deliveryType,
          timeslotStart: ctx.timeslotStart,
          timeslotEnd: ctx.timeslotEnd,
          products: PROBES,
          limit: 3,
        }),
      )) as typeof found;
    } catch (err) {
      console.log(`  block2 search failed: ${errMsg(err)}`);
      results.block2 = { searchError: errMsg(err) };
    }
    await dump("block2-search", found);
    const details: unknown[] = [];
    for (const q of found.queries ?? []) {
      const slug = q.products?.[0]?.slug;
      if (!slug) {
        details.push({ query: q.query, note: "no product found" });
        continue;
      }
      try {
        const d = await silpo.callToolRaw("silpo_get_product_details", {
          branchId: ctx.branchId,
          deliveryType: ctx.deliveryType,
          timeslotStart: ctx.timeslotStart,
          timeslotEnd: ctx.timeslotEnd,
          slug,
        });
        details.push({ query: q.query, slug, details: d });
      } catch (err) {
        details.push({ query: q.query, slug, error: errMsg(err) });
      }
    }
    await dump("block2-details", details);
    results.block2 = {
      probed: details.length,
      perProduct: details.map((d) => {
        const rec = d as { query?: string; details?: Record<string, unknown> };
        const det = rec.details ?? {};
        const s = JSON.stringify(det).toLowerCase();
        return {
          query: rec.query,
          keys: det && typeof det === "object" ? Object.keys(det) : [],
          mentionsComposition: /склад|composition|ingredient/i.test(s),
          mentionsNutrition: /білк|жир|вуглевод|калор|ккал|protein|kcal|energy/i.test(s),
          mentionsAllergen: /алерг|allergen/i.test(s),
        };
      }),
      oneDetailsShape: shape(
        (
          details.find((d) => (d as { details?: unknown }).details) as
            { details?: unknown } | undefined
        )?.details,
      ),
    };
  } else {
    console.log("  skipped — no cart context");
    results.block2 = { skipped: "no cart context" };
  }

  // ── Block 3 — food_restrictions + family + profile ─────────────────────────
  console.log("\n── Block 3 — restrictions / family (ASM-04, Q-04)");
  for (const [tool, key] of [
    ["silpo_get_my_food_restrictions", "foodRestrictions"],
    ["silpo_get_my_family", "family"],
    ["silpo_get_my_profile", "profile"],
    ["silpo_get_my_delivery_addresses", "deliveryAddresses"],
  ] as const) {
    try {
      const v = await timed(tool, () => silpo.callToolRaw(tool));
      await dump(`block3-${key}`, v);
      (results as Record<string, unknown>)[`block3_${key}`] = shape(redact(v));
    } catch (err) {
      (results as Record<string, unknown>)[`block3_${key}`] = { error: errMsg(err) };
    }
  }

  // ── Block 4 — find_products_batch quality + limits ─────────────────────────
  console.log("\n── Block 4 — search quality + rate limits (ASM-03, Q-03)");
  const RECIPE_STRINGS = [
    "куряче філе",
    "сметана 20%",
    "пучок кропу",
    "оливкова олія",
    "томатна паста",
    "цибуля ріпчаста",
    "часник",
    "перець солодкий",
    "рис круглозернистий",
    "сир твердий",
  ];
  if (gated) {
    const timings: number[] = [];
    let rateLimitedAt: number | null = null;
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      try {
        const r = (await silpo.callToolRaw("silpo_find_products_batch", {
          branchId: ctx.branchId,
          deliveryType: ctx.deliveryType,
          timeslotStart: ctx.timeslotStart,
          timeslotEnd: ctx.timeslotEnd,
          products: RECIPE_STRINGS,
          limit: 5,
        })) as {
          queries?: {
            query?: string;
            products?: { title?: string; price?: number; stock?: number }[];
          }[];
        };
        timings.push(Date.now() - t0);
        console.log(
          `  call ${i + 1}: ${Date.now() - t0} ms, ${r.queries?.length ?? 0} query groups`,
        );
        if (i === 0) {
          await dump("block4-search", r);
          results.block4 = {
            firstCallResults: (r.queries ?? []).map((q) => ({
              query: q.query,
              topMatches: (q.products ?? []).slice(0, 3).map((p) => p.title),
              hasPrice: q.products?.[0]?.price !== undefined,
              hasStock: q.products?.[0]?.stock !== undefined,
            })),
          };
        }
      } catch (err) {
        const e = err as { code?: number };
        console.log(`  call ${i + 1}: ${errMsg(err)}`);
        if (e.code === 429 && rateLimitedAt === null) rateLimitedAt = i + 1;
        break;
      }
    }
    (results.block4 as Record<string, unknown>).timingsMs = timings;
    (results.block4 as Record<string, unknown>).rateLimitedAtCall = rateLimitedAt;
  } else {
    console.log("  skipped — no cart context");
    results.block4 = { skipped: "no cart context" };
  }

  // ── Block 5 — promotions ──────────────────────────────────────────────────
  console.log("\n── Block 5 — promotions (FR-PLAN-004)");
  if (gated) {
    try {
      const promos = await timed("get_promotions", () =>
        silpo.callToolRaw("silpo_get_promotions", {
          branchId: ctx.branchId,
          deliveryType: ctx.deliveryType,
          timeslotStart: ctx.timeslotStart,
          timeslotEnd: ctx.timeslotEnd,
        }),
      );
      await dump("block5-promotions", promos);
      const arr =
        (promos as { promotions?: unknown[]; items?: unknown[] }).promotions ??
        (promos as { items?: unknown[] }).items ??
        [];
      results.block5 = { promotionsCount: arr.length, oneShape: shape(arr[0]) };
    } catch (err) {
      results.block5 = { promotions: { error: errMsg(err) } };
    }
  } else {
    results.block5 = { skipped: "no cart context" };
  }
  try {
    const myPromos = await timed("get_my_promos", () => silpo.callToolRaw("silpo_get_my_promos"));
    await dump("block5-my-promos", myPromos);
    const arr =
      (myPromos as { promos?: unknown[]; items?: unknown[] }).promos ??
      (myPromos as { items?: unknown[] }).items ??
      [];
    (results.block5 as Record<string, unknown>).myPromosCount = Array.isArray(arr)
      ? arr.length
      : "?";
    (results.block5 as Record<string, unknown>).myPromosOneShape = shape(
      Array.isArray(arr) ? arr[0] : myPromos,
    );
  } catch (err) {
    (results.block5 as Record<string, unknown>).myPromos = { error: errMsg(err) };
  }

  // ── Block 7 — errors ─────────────────────────────────────────────────────
  console.log("\n── Block 7 — errors (INT-MCP-002)");
  const block7: Record<string, unknown> = {};
  if (gated) {
    try {
      const bogus = await silpo.callToolRaw("silpo_get_product_details", {
        branchId: ctx.branchId,
        deliveryType: ctx.deliveryType,
        timeslotStart: ctx.timeslotStart,
        timeslotEnd: ctx.timeslotEnd,
        slug: "definitely-not-a-real-slug-zzz-9999",
      });
      block7.bogusSlug = shape(bogus);
    } catch (err) {
      block7.bogusSlug = { error: errMsg(err) };
    }
  }
  try {
    const loyalty = await silpo.callToolRaw("silpo_get_loyalty_info");
    await dump("block7-loyalty", loyalty);
    block7.loyaltyShape = shape(redact(loyalty));
  } catch (err) {
    block7.loyalty = { error: errMsg(err) };
  }
  results.block7 = block7;

  await writeFile(`${RAW_DIR}summary.json`, JSON.stringify(results, null, 2) + "\n", "utf8");
  console.log("\n── Summary written to docs/mcp-audit-raw/summary.json");
  console.log(JSON.stringify(results, null, 2));
}

main()
  .then(closeDb)
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
