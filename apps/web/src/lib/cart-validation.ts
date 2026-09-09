import type { CartValidation } from "@navar/domain";

import { uah } from "./format";

/**
 * One Silpo `validations[]` entry → a Guest-facing sentence. Matches on the stable
 * dot-namespaced `message` code and never echoes a raw code back (the `default` is a
 * friendly generic, not `v.message`).
 */
export function humanValidation(v: CartValidation): string {
  const m = v.message;
  if (m === "order.cost.min") {
    const min = typeof v.context?.orderCostMin === "number" ? v.context.orderCostMin : null;
    return min != null
      ? `Сума кошика нижча за мінімальну для замовлення — ${uah(min)}`
      : "Сума кошика нижча за мінімальну для замовлення";
  }
  if (m === "timeslot.not_found") return "Оберіть слот доставки нижче";
  if (m === "product.offer.stock.max" || m === "product.offer.stock.min")
    return "Деяких товарів немає в потрібній кількості";
  if (m === "order.payment_types.disabled")
    return "Частина способів оплати недоступна для цієї суми";
  return "Деякі позиції потребують уваги перед оформленням";
}

/**
 * The cart can carry one `product.offer.stock.max` per line (×6, ×19 seen live) — all
 * humanising to the same sentence. Collapse a level's validations to the distinct
 * messages, order preserved, so the Guest sees each reason once.
 */
export function distinctValidationMessages(
  validations: readonly CartValidation[],
  level: CartValidation["level"],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of validations) {
    if (v.level !== level) continue;
    const msg = humanValidation(v);
    if (seen.has(msg)) continue;
    seen.add(msg);
    out.push(msg);
  }
  return out;
}
