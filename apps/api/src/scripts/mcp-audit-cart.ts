import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { closeDb } from "@navar/db";

import { getSilpoProvider } from "../retail.js";
import { type CartView, cartLines, isRateLimit, summariseCart } from "./audit-util.js";

/**
 * `pnpm mcp:audit:cart` — MCP audit checklist Block 6 (cart write + idempotency +
 * checkoutWebLink). WRITES to the live cart: adds up to 3 cheap items, re-adds them to
 * probe idempotency, reads `validations[]` / `checkoutWebLink` / `loyalty`, then removes
 * exactly the items it added. Never clears the cart (`FR-CART-004`); pre-existing lines are
 * recorded first and left untouched.
 *
 * Cart writes are rate-limited by the server (a plain-text "Rate limit exceeded", not a
 * JSON-RPC 429), so every write is spaced by WRITE_GAP_MS and retried with backoff.
 * Partial results are always flushed to disk. Run deliberately, on a safe cart.
 */
const RAW_DIR = fileURLToPath(new URL("../../../../docs/mcp-audit-raw/", import.meta.url));
const OUT = `${RAW_DIR}block6-cart.json`;
const PROBES = ["сіль кухонна", "цукор", "вода питна негазована", "сірники", "пакет"];
const WRITE_GAP_MS = 6000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const steps: Record<string, unknown>[] = [];
const flush = () => writeFile(OUT, JSON.stringify(steps, null, 2) + "\n", "utf8");

/** Retry a cart write past the server's text-based rate limit. */
async function write(
  silpo: Awaited<ReturnType<typeof getSilpoProvider>>,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await silpo.callToolRaw(tool, args);
    } catch (err) {
      if (isRateLimit(err) && attempt <= 4) {
        const wait = WRITE_GAP_MS * attempt;
        console.log(`  ${tool}: rate-limited, waiting ${wait} ms (attempt ${attempt})`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
}

async function main(): Promise<void> {
  await mkdir(RAW_DIR, { recursive: true });
  const silpo = await getSilpoProvider();

  const myCart = (await silpo.callToolRaw("silpo_get_my_shopping_cart")) as {
    shoppingCartId?: string;
    exists?: boolean;
  };
  if (!myCart.shoppingCartId || myCart.exists === false) {
    steps.push({ label: "no-cart", myCart });
    await flush();
    console.log("No cart (exists=false) — not creating one. Recorded and done.");
    return;
  }
  const cartId = myCart.shoppingCartId;
  const ctx = await silpo.getCartContext();
  const read = (): Promise<CartView> =>
    silpo.callToolRaw("silpo_get_shopping_cart_by_id", {
      shoppingCartId: cartId,
    }) as Promise<CartView>;

  const before = await read();
  const beforeIds = new Set(cartLines(before).map((l) => l.productId));
  steps.push({ label: "cartId", cartId, branch: ctx.branchId, deliveryType: ctx.deliveryType });
  steps.push(summariseCart(before, "0-before"));
  await flush();
  console.log(
    `baseline: ${cartLines(before).length} pre-existing lines, total ${before.cart?.calculation?.total}`,
  );

  const found = (await silpo.callToolRaw("silpo_find_products_batch", {
    branchId: ctx.branchId,
    deliveryType: ctx.deliveryType,
    timeslotStart: ctx.timeslot.start,
    timeslotEnd: ctx.timeslot.end,
    products: PROBES,
    limit: 5,
  })) as {
    queries?: {
      query?: string;
      products?: {
        id?: string;
        name?: string;
        companyId?: string;
        branchId?: string;
        available?: boolean;
        weighted?: boolean;
        price?: number;
      }[];
    }[];
  };
  const picks = (found.queries ?? [])
    .map((q) => (q.products ?? []).find((p) => p.available && !p.weighted && p.id && p.companyId))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .filter((p) => !beforeIds.has(p.id));
  if (picks.length < 2) {
    steps.push({
      label: "abort",
      reason: "no safe picks",
      tried: found.queries?.map((q) => q.query),
    });
    await flush();
    console.log("Not enough safe test products; aborted without any write.");
    return;
  }
  const testProducts = picks.slice(0, 3).map((p) => ({
    productId: p.id!,
    companyId: p.companyId!,
    branchId: p.branchId ?? ctx.branchId,
    quantity: 1,
  }));
  steps.push({
    label: "picks",
    items: picks.slice(0, 3).map((p) => ({ id: p.id, name: p.name, price: p.price })),
  });
  await flush();
  console.log(
    `test items: ${picks
      .slice(0, 3)
      .map((p) => p.name)
      .join(" | ")}`,
  );

  const qtyOf = (v: CartView, id: string) => cartLines(v).find((l) => l.productId === id)?.quantity;
  let after1: CartView | undefined;
  let after2: CartView | undefined;
  let after3: CartView | undefined;

  try {
    steps.push({
      label: "1-add-response",
      response: await write(silpo, "silpo_add_or_update_cart_products", {
        shoppingCartId: cartId,
        products: testProducts,
      }),
    });
    after1 = await read();
    steps.push(summariseCart(after1, "1-after-first-add"));
    await flush();
    console.log(`after first add: ${cartLines(after1).length} lines`);

    await sleep(WRITE_GAP_MS);
    steps.push({
      label: "2-identical-readd-response",
      response: await write(silpo, "silpo_add_or_update_cart_products", {
        shoppingCartId: cartId,
        products: testProducts,
      }),
    });
    after2 = await read();
    steps.push(summariseCart(after2, "2-after-identical-readd"));
    await flush();

    await sleep(WRITE_GAP_MS);
    steps.push({
      label: "3-addQuantity-false-response",
      response: await write(silpo, "silpo_add_or_update_cart_products", {
        shoppingCartId: cartId,
        products: testProducts.map((p) => ({ ...p, addQuantity: false })),
      }),
    });
    after3 = await read();
    steps.push(summariseCart(after3, "3-after-addQuantity-false"));
    await flush();

    steps.push({
      label: "idempotency-verdict",
      perProduct: testProducts.map((p) => ({
        productId: p.productId,
        afterFirstAdd: after1 && qtyOf(after1, p.productId),
        afterIdenticalReadd: after2 && qtyOf(after2, p.productId),
        afterAddQuantityFalse: after3 && qtyOf(after3, p.productId),
      })),
    });
  } catch (err) {
    steps.push({ label: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    await sleep(WRITE_GAP_MS);
    try {
      steps.push({
        label: "4-remove-response",
        response: await write(silpo, "silpo_remove_cart_products", {
          shoppingCartId: cartId,
          products: testProducts.map((p) => ({ productId: p.productId })),
        }),
      });
      const after = await read();
      steps.push(summariseCart(after, "4-after-cleanup"));
      const afterIds = new Set(cartLines(after).map((l) => l.productId));
      const leaked = testProducts.filter((p) => afterIds.has(p.productId)).map((p) => p.productId);
      const restored = [...beforeIds].every((id) => afterIds.has(id!));
      steps.push({ label: "cleanup-check", leaked, baselineRestored: restored });
      console.log(
        leaked.length === 0 && restored
          ? "cleanup OK — cart back to baseline"
          : `⚠️ cleanup INCOMPLETE — leaked ${JSON.stringify(leaked)}, baseline restored: ${restored}`,
      );
    } catch (err) {
      steps.push({
        label: "cleanup-error",
        message: err instanceof Error ? err.message : String(err),
        leakedProductIds: testProducts.map((p) => p.productId),
      });
      console.log(
        `⚠️ CLEANUP FAILED — manually remove: ${testProducts.map((p) => p.productId).join(", ")}`,
      );
    }
    await flush();
  }

  console.log(`\n── Block 6 written to ${OUT}`);
  for (const s of steps)
    if (s.label === "idempotency-verdict" || s.label === "cleanup-check")
      console.log(JSON.stringify(s, null, 2));
}

main()
  .then(closeDb)
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
