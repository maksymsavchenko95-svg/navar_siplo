import {
  type CartContext,
  type CartDeliveryEcho,
  type CartLine,
  type CartLoyalty,
  type CartValidation,
  type CartView,
  type CartWriteResult,
  parseKcal,
  type PersonalPromo,
  type ProductDetails,
  type ProductMatch,
  type ProductSearchResult,
  type Promotion,
  type RawRestriction,
  type ReplacementResult,
  type RetailAddress,
  type RetailFamily,
  type RetailFavorite,
  type RetailLine,
  type RetailOrder,
  type RetailProfile,
} from "@navar/domain";

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
  slots?: { start?: string; end?: string; available?: boolean; minOrderCost?: number }[];
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
  return {
    branchId,
    deliveryType,
    timeslot: {
      start: chosen.start,
      end: chosen.end,
      // Only `silpo_get_time_slots` carries this (MCP `1.109.8`); keep it for R4.
      minOrderCost: typeof chosen.minOrderCost === "number" ? chosen.minOrderCost : null,
    },
  };
}

/** The product shape shared by `find_products_batch`, `get_replacements`, `get_similar_products`. */
interface RawProduct {
  id?: string;
  externalProductId?: number | null;
  companyId?: string | null;
  branchId?: string | null;
  slug?: string;
  name?: string;
  price?: number;
  oldPrice?: number | null;
  displayRatio?: string | null;
  image?: string | null;
  stock?: number;
  available?: boolean;
  weighted?: boolean;
  step?: number;
  specialPrices?: { price?: number; count?: number; type?: string }[] | null;
}

interface FindBatch {
  queries?: { query?: string; products?: RawProduct[] }[];
}

function toMatch(p: RawProduct): ProductMatch {
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
    weighted: p.weighted === true,
    step: typeof p.step === "number" && p.step > 0 ? p.step : null,
    // Multi-buy tiers (T4.1). Independent of `oldPrice` — dropping these used to make the
    // whole «Гуртом дешевше» campaign invisible to the mapper and the promo share.
    specialPrices: (p.specialPrices ?? [])
      .filter((s) => typeof s?.price === "number" && typeof s?.count === "number")
      .map((s) => ({
        price: s.price as number,
        count: s.count as number,
        type: str(s.type) ?? "",
      })),
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

function attrNum(attributes: Record<string, unknown>, key: string): number | null {
  const v = attributes[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * `silpo_get_product_details` → `ProductDetails`. `attributes` is a raw key→value object
 * (or `null`); macros live under the Ukrainian attribute names, energy as a `"kcal/kJ"`
 * string (`parseKcal`). Composition + allergen coverage is thin (M0 audit) — read
 * defensively and let the caller fail closed.
 */
export function toProductDetails(raw: unknown): ProductDetails {
  const p = (raw as { product?: Record<string, unknown> }).product ?? {};
  const attributes: Record<string, string | number> = {};
  const rawAttrs = p.attributes;
  if (rawAttrs && typeof rawAttrs === "object") {
    for (const [k, v] of Object.entries(rawAttrs)) {
      if (typeof v === "string" || typeof v === "number") attributes[k] = v;
    }
  }
  const allergenRaw = attributes["Містить алергени"];
  return {
    slug: typeof p.slug === "string" ? p.slug : "",
    name: typeof p.name === "string" ? p.name : "",
    price: typeof p.price === "number" ? p.price : 0,
    oldPrice: typeof p.oldPrice === "number" ? p.oldPrice : null,
    inStock: p.available === true && (typeof p.stock === "number" ? p.stock : 0) > 0,
    weighted: p.weighted === true,
    packSize: typeof p.displayRatio === "string" ? p.displayRatio : null,
    // For `weighted:true` this is kilograms regardless of `displayRatio` (MCP `1.109.8`).
    step: typeof p.step === "number" && p.step > 0 ? p.step : null,
    attributes,
    composition: typeof attributes["Склад"] === "string" ? (attributes["Склад"] as string) : null,
    allergens:
      typeof allergenRaw === "string"
        ? allergenRaw
            .split(/[,;/]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    kcal100: parseKcal(String(attributes["Енергетична цінність (кКал/кДЖ)"] ?? "")),
    protein100: attrNum(attributes, "Білки (г)"),
    fat100: attrNum(attributes, "Жири (г)"),
    carbs100: attrNum(attributes, "Вуглеводи (г)"),
  };
}

// ─── Cart materialize (T3.1 / T3.2) ──────────────────────────────────────────

interface RawCartLine {
  productId?: string;
  id?: string;
  name?: string;
  title?: string;
  quantity?: number;
  count?: number;
  price?: number;
  sum?: number;
}
interface RawCartShipment {
  companyId?: string;
  branchId?: string;
  address?: Record<string, unknown>;
  products?: RawCartLine[];
}
interface RawValidation {
  level?: string;
  type?: string;
  message?: string;
  context?: Record<string, unknown>;
}
interface CartByIdFull {
  cart?: {
    deliveryType?: string;
    timeslot?: { start?: string; end?: string };
    address?: Record<string, unknown>;
    shipments?: RawCartShipment[];
    calculation?: {
      total?: number;
      totalAfterDiscounts?: number;
      validations?: RawValidation[];
    };
  };
  loyalty?: {
    bonusAvailable?: number;
    bonusTotal?: number;
    bonusRequested?: number | null;
    isEnabled?: boolean;
  } | null;
  checkoutWebLink?: string;
  checkoutMobileLink?: string;
}

/**
 * `silpo_get_my_shopping_cart` + `silpo_get_shopping_cart_by_id` → the whole live cart
 * (T3.1). `loyalty` / `checkoutWebLink` / `checkoutMobileLink` are **siblings** of `cart`;
 * `validations[]` / totals live under `cart.calculation`. `delivery` is `null` unless every
 * field `silpo_update_shopping_cart` needs is present — T3.2 refuses the bonus apply then.
 * Throws `NoCartError` when the Guest has no cart (never creates one — `FR-CART-004`).
 */
export function toCartView(myCart: MyCart, cartById: unknown): CartView {
  if (myCart.exists === false || !myCart.shoppingCartId) throw new NoCartError();
  const r = (cartById ?? {}) as CartByIdFull;
  const cart = r.cart ?? {};
  const shipments = cart.shipments ?? [];

  const lines: CartLine[] = shipments.flatMap((s) =>
    (s.products ?? []).map((p) => {
      const price = p.price ?? p.sum;
      return {
        productId: p.productId ?? p.id ?? "",
        name: str(p.name ?? p.title),
        quantity: num(p.quantity ?? p.count),
        price: typeof price === "number" ? price : null,
      };
    }),
  );

  const validations: CartValidation[] = (cart.calculation?.validations ?? [])
    .filter(
      (v): v is RawValidation & { level: "error" | "info" } =>
        v.level === "error" || v.level === "info",
    )
    .map((v) => ({
      level: v.level,
      type: typeof v.type === "string" ? v.type : "",
      message: typeof v.message === "string" ? v.message : "",
      ...(v.context && typeof v.context === "object" ? { context: v.context } : {}),
    }));

  const l = r.loyalty;
  const loyalty: CartLoyalty | null =
    l && typeof l === "object"
      ? {
          bonusAvailable: num(l.bonusAvailable),
          bonusTotal: num(l.bonusTotal),
          bonusRequested: typeof l.bonusRequested === "number" ? l.bonusRequested : null,
          isEnabled: l.isEnabled === true,
        }
      : null;

  const echoShipments = shipments
    .map((s) => ({ companyId: s.companyId ?? "", branchId: s.branchId ?? "" }))
    .filter((s) => s.companyId.length > 0 && s.branchId.length > 0);
  const address = cart.address ?? shipments[0]?.address;
  const delivery: CartDeliveryEcho | null =
    cart.deliveryType &&
    cart.timeslot?.start &&
    cart.timeslot?.end &&
    address &&
    echoShipments.length > 0
      ? {
          deliveryType: cart.deliveryType,
          timeslot: { start: cart.timeslot.start, end: cart.timeslot.end },
          address,
          shipments: echoShipments,
        }
      : null;

  const calc = cart.calculation ?? {};
  return {
    shoppingCartId: myCart.shoppingCartId,
    lines,
    totalUah: typeof calc.total === "number" ? calc.total : null,
    totalAfterDiscountsUah:
      typeof calc.totalAfterDiscounts === "number" ? calc.totalAfterDiscounts : null,
    validations,
    loyalty,
    checkoutWebLink: str(r.checkoutWebLink),
    checkoutMobileLink: str(r.checkoutMobileLink),
    delivery,
  };
}

/** `silpo_add_or_update_cart_products` / `..._remove_cart_products` / `..._update_shopping_cart` payload. */
export function toCartWriteResult(raw: unknown): CartWriteResult {
  const r = (raw ?? {}) as {
    success?: boolean;
    summary?: string;
    products?: { productId?: string; quantity?: number }[];
  };
  return {
    success: r.success === true,
    summary: typeof r.summary === "string" ? r.summary : "",
    products: (r.products ?? [])
      .filter((p) => typeof p.productId === "string")
      .map((p) => ({
        productId: p.productId as string,
        ...(typeof p.quantity === "number" ? { quantity: p.quantity } : {}),
      })),
  };
}

interface ReplacementsResponse {
  items?: { productId?: string; replacements?: RawProduct[] }[];
}

/** `silpo_get_replacements` → one `ReplacementResult` per requested id, in request order. */
export function toReplacementResults(raw: unknown, productIds: string[]): ReplacementResult[] {
  const byId = new Map(
    ((raw as ReplacementsResponse).items ?? []).map((it) => [
      it.productId ?? "",
      (it.replacements ?? []).map(toMatch),
    ]),
  );
  return productIds.map((productId) => ({
    productId,
    replacements: byId.get(productId) ?? [],
  }));
}

// ─── Household reads (T1.4) — every mapper drops PII at the package boundary ────

function num(x: unknown, fallback = 0): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}
function str(x: unknown): string | null {
  return typeof x === "string" && x.length > 0 ? x : null;
}

/** `silpo_get_my_profile` → `{ silpoProfileId, gender, birthYear }`. Drops name/phone/email/status. */
export function parseProfile(raw: unknown): RetailProfile {
  const p = (raw as { profile?: Record<string, unknown> }).profile ?? {};
  const birthday = typeof p.birthday === "string" ? p.birthday : "";
  const year = Number.parseInt(birthday.slice(0, 4), 10);
  return {
    silpoProfileId: typeof p.id === "string" ? p.id : "",
    gender: str(p.gender),
    birthYear: Number.isFinite(year) && year > 1900 && year < 2100 ? year : null,
  };
}

interface RawFamily {
  members?: { itsMe?: boolean; profileId?: string }[];
  children?: { dateOfBirth?: string }[];
  pets?: unknown[];
}

/** `silpo_get_my_family` → counts + child ages. Drops every name/phone/image. */
export function parseFamily(raw: unknown, now: Date = new Date()): RetailFamily {
  const f = raw as RawFamily;
  const members = f.members ?? [];
  const children = f.children ?? [];
  const childAgeYears = children
    .map((c) => ageFromDob(c.dateOfBirth, now))
    .filter((a): a is number => a !== null);
  return {
    adultCount: Math.max(members.length, 1), // the guest is always at least one adult
    childAgeYears,
    petCount: (f.pets ?? []).length,
    itsMeProfileId: str(members.find((m) => m.itsMe)?.profileId) ?? str(members[0]?.profileId),
  };
}

function ageFromDob(dob: string | undefined, now: Date): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age <= 25 ? age : null;
}

/**
 * `silpo_get_my_food_restrictions` → free text per entry for `parseRestrictions`.
 * Q-04: the populated element shape is still unobserved (test account returns `[]`) — read
 * `slug` + any label-ish field defensively. See `docs/mcp-audit-results.md` follow-up #10.
 */
export function parseRestrictionsRaw(raw: unknown): RawRestriction[] {
  const list = (raw as { restrictions?: Record<string, unknown>[] }).restrictions ?? [];
  return list
    .map((r) => {
      const text = [r.name, r.title, r.description, r.label]
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .join(" — ");
      return { slug: typeof r.slug === "string" ? r.slug : "", text: text || String(r.slug ?? "") };
    })
    .filter((r) => r.text.length > 0);
}

/** `silpo_get_my_delivery_addresses` → `{ id, tag, city }` only. Drops street/building/geo/comment. */
export function parseAddresses(raw: unknown): RetailAddress[] {
  const list = (raw as { addresses?: Record<string, unknown>[] }).addresses ?? [];
  return list
    .map((a) => ({
      id: typeof a.id === "string" ? a.id : "",
      tag: str(a.tag),
      city: str(a.city) ?? "",
    }))
    .filter((a) => a.id.length > 0);
}

interface RawOrderLine {
  // online
  id?: string;
  subtotal?: number;
  // offline
  lagerId?: number;
  catalogProduct?: { id?: string; slug?: string } | null;
  // both
  name?: string;
  price?: number;
  quantity?: number;
  unit?: string;
}
interface RawOrder {
  orderId?: string; // online
  filId?: number; // offline
  createdAt?: string;
  amount?: number; // online total
  sumReg?: number; // offline total
  discount?: number; // online
  sumDiscount?: number; // offline
  products?: RawOrderLine[];
}

function toRetailLine(l: RawOrderLine): RetailLine {
  const slug = str(l.catalogProduct?.slug);
  const name = str(l.name) ?? "";
  const key =
    slug ??
    (typeof l.lagerId === "number" ? `lager:${l.lagerId}` : name ? `name:${name}` : "unknown");
  const unitPrice = num(l.price);
  const quantity = num(l.quantity);
  return {
    key,
    name,
    slug,
    unitPrice,
    quantity,
    lineTotal: Math.round(unitPrice * quantity * 100) / 100,
    unit: str(l.unit),
    catalogProductId: str(l.catalogProduct?.id),
  };
}

/** Normalise a naive timestamp (`2026-08-17T20:11:07`, no offset) to ISO-UTC. */
function toIsoUtc(raw: string | undefined): string {
  if (!raw) return new Date(0).toISOString();
  const hasZone = /[+-]\d{2}:?\d{2}$|Z$/.test(raw);
  const d = new Date(hasZone ? raw : `${raw}Z`);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

/**
 * Map a `silpo_get_my_online_orders` / `_offline_orders` page to the unified `RetailOrder[]`.
 * Discriminates on `orderId` (online) vs `filId` (offline). Drops address / receipt URL.
 */
export function parseOrders(raw: unknown): RetailOrder[] {
  const orders = (raw as { orders?: RawOrder[] }).orders ?? [];
  return orders.map((o) => {
    const online = typeof o.orderId === "string";
    return {
      source: online ? ("online" as const) : ("offline" as const),
      externalId: online ? o.orderId! : `fil:${o.filId ?? "?"}:${o.createdAt ?? ""}`,
      createdAt: toIsoUtc(o.createdAt),
      total: online ? num(o.amount) : num(o.sumReg),
      discount: online ? num(o.discount) : num(o.sumDiscount),
      lines: (o.products ?? []).map(toRetailLine),
    };
  });
}

interface RawFavorite {
  id?: string;
  slug?: string;
  name?: string;
  price?: number;
  available?: boolean;
  companyId?: string;
  branchId?: string | null;
}

/** `silpo_get_my_favorites` → trimmed SKU list. No PII (product data only). */
export function parseFavorites(raw: unknown): RetailFavorite[] {
  const list = (raw as { products?: RawFavorite[] }).products ?? [];
  return list.map((p) => ({
    productId: typeof p.id === "string" ? p.id : "",
    slug: str(p.slug) ?? "",
    name: str(p.name) ?? "",
    price: num(p.price),
    available: p.available === true,
    companyId: str(p.companyId) ?? "",
    branchId: typeof p.branchId === "string" ? p.branchId : null,
  }));
}

// ─── Promotions (T4.1, FR-PLAN-004) ─────────────────────────────────────────

interface RawPromotion {
  code?: string;
  title?: string;
  productCount?: number;
  url?: string | null;
}

/**
 * `silpo_get_promotions` → the branch's active campaign groups. Campaigns, **not** SKUs —
 * the promo products live one level down, via `silpo_get_products` filtered by `code`
 * (M0 audit Block 5). Entries without a usable `code` are dropped: the code is the only
 * field that can be acted on.
 */
export function parsePromotions(raw: unknown): Promotion[] {
  const list = (raw as { promotions?: RawPromotion[] }).promotions ?? [];
  return list
    .map((p) => ({
      code: str(p.code) ?? "",
      title: str(p.title) ?? "",
      productCount: num(p.productCount),
      url: str(p.url),
    }))
    .filter((p) => p.code.length > 0);
}

interface RawMyPromo {
  promoId?: number;
  selected?: boolean;
  beginDate?: string | null;
  endDate?: string | null;
  description?: string | null;
  rewardText?: string | null;
  rewardValue?: number | null;
  limitText?: string | null;
}

/**
 * `silpo_get_my_promos` → the guest's personal offers. These are **bonus multipliers, not
 * price cuts** — they must not feed `promo_share` or budget arithmetic (M0 audit).
 * `endDate` is kept because a weekly plan can outlast an offer. Drops the presentational
 * fields (`image`, `addressListText`, `warningText`) — nothing downstream renders them yet.
 */
export function parseMyPromos(raw: unknown): PersonalPromo[] {
  const list = (raw as { promos?: RawMyPromo[] }).promos ?? [];
  return list
    .filter((p) => typeof p?.promoId === "number")
    .map((p) => ({
      promoId: p.promoId as number,
      selected: p.selected === true,
      beginDate: str(p.beginDate),
      endDate: str(p.endDate),
      description: str(p.description),
      rewardText: str(p.rewardText),
      rewardValue: typeof p.rewardValue === "number" ? p.rewardValue : null,
      limitText: str(p.limitText),
    }));
}
