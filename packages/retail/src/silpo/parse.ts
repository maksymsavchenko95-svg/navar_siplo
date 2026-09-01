import type { CartContext, ProductMatch, ProductSearchResult } from "@navar/domain";

import { NoCartError } from "../provider.js";

/** Extract the text payload of an MCP tool result and JSON-parse it. */
export function parseToolResult(result: unknown): unknown {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const text = content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

interface MyCart {
  exists?: boolean;
  shoppingCartId?: string;
}
interface CartById {
  cart?: {
    deliveryType?: string;
    timeslot?: { start?: string; end?: string };
    shipments?: { branchId?: string }[];
  };
}
interface TimeSlots {
  slots?: { start?: string; end?: string; available?: boolean }[];
}

/**
 * Build cart context from the three ordered calls
 * (`silpo_get_my_shopping_cart` → `..._by_id` → `silpo_get_time_slots`). The cart's own
 * timeslot is frequently stale, so a fresh slot is always chosen — preferring an
 * available one, else the first returned (search tolerates unavailable slots).
 */
export function toCartContext(myCart: MyCart, cartById: CartById, slots: TimeSlots): CartContext {
  if (myCart.exists === false || !myCart.shoppingCartId) throw new NoCartError();

  const branchId = cartById.cart?.shipments?.[0]?.branchId;
  const deliveryType = cartById.cart?.deliveryType;
  if (!branchId || !deliveryType) throw new NoCartError();

  const list = slots.slots ?? [];
  const chosen = list.find((s) => s.available) ?? list[0];
  if (!chosen?.start || !chosen?.end) {
    throw new Error("Silpo returned no delivery timeslots for this branch");
  }
  return { branchId, deliveryType, timeslot: { start: chosen.start, end: chosen.end } };
}

interface FindBatch {
  queries?: {
    query?: string;
    products?: {
      id?: string;
      externalProductId?: number;
      companyId?: string;
      branchId?: string;
      slug?: string;
      name?: string;
      price?: number;
      oldPrice?: number | null;
      displayRatio?: string | null;
      image?: string | null;
      stock?: number;
      available?: boolean;
    }[];
  }[];
}

function toMatch(
  p: NonNullable<NonNullable<FindBatch["queries"]>[number]["products"]>[number],
): ProductMatch {
  return {
    productId: p.id ?? "",
    externalProductId: typeof p.externalProductId === "number" ? p.externalProductId : null,
    companyId: p.companyId ?? "",
    branchId: p.branchId ?? "",
    slug: p.slug ?? "",
    name: p.name ?? "",
    price: typeof p.price === "number" ? p.price : 0,
    oldPrice: typeof p.oldPrice === "number" ? p.oldPrice : null,
    packSize: p.displayRatio ?? null,
    imageUrl: p.image ?? null,
    inStock: p.available === true && (p.stock ?? 0) > 0,
  };
}

/** Map a `silpo_find_products_batch` response, aligned to the input query order. */
export function toProductSearchResults(
  response: FindBatch,
  queries: string[],
): ProductSearchResult[] {
  const byQuery = new Map((response.queries ?? []).map((q) => [q.query ?? "", q.products ?? []]));
  return queries.map((query) => ({
    query,
    products: (byQuery.get(query) ?? []).map(toMatch),
  }));
}
