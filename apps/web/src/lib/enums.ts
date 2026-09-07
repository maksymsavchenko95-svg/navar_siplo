/**
 * Label ↔ enum maps for the wizard forms. The screens show Ukrainian labels; the tRPC
 * procedures take the domain enum values (`nutritionComputedFromSchema`). Keep these in
 * sync with `@navar/domain` — mirrored here (not imported) to avoid a heavier workspace
 * dependency in the web bundle. Covered by `enums.test.ts`.
 */

export type Sex = "male" | "female";
export type Activity = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type Direction = "gain" | "maintain" | "reduce";

export const SEX_OPTIONS: ReadonlyArray<{ value: Sex; label: string }> = [
  { value: "female", label: "Ж" },
  { value: "male", label: "Ч" },
];

/** Five levels — the domain has five, the prototype only drew three. */
export const ACTIVITY_OPTIONS: ReadonlyArray<{ value: Activity; label: string }> = [
  { value: "sedentary", label: "Низька" },
  { value: "light", label: "Легка" },
  { value: "moderate", label: "Середня" },
  { value: "active", label: "Висока" },
  { value: "very_active", label: "Дуже висока" },
];

export const DIRECTION_OPTIONS: ReadonlyArray<{ value: Direction; label: string }> = [
  { value: "gain", label: "Набір" },
  { value: "maintain", label: "Утримання" },
  { value: "reduce", label: "Зниження" },
];

export function labelFor<T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>,
  value: T,
): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/* ---- restriction pickers (EU-14 allergens + diet codes) ---------------- */

export type AllergenCode =
  | "gluten"
  | "crustaceans"
  | "egg"
  | "fish"
  | "peanuts"
  | "soybeans"
  | "milk"
  | "tree_nuts"
  | "celery"
  | "mustard"
  | "sesame"
  | "sulphites"
  | "lupin"
  | "molluscs";

export const ALLERGEN_LABEL_UK: Record<AllergenCode, string> = {
  gluten: "глютен",
  crustaceans: "ракоподібні",
  egg: "яйця",
  fish: "риба",
  peanuts: "арахіс",
  soybeans: "соя",
  milk: "молоко",
  tree_nuts: "горіхи",
  celery: "селера",
  mustard: "гірчиця",
  sesame: "кунжут",
  sulphites: "сульфіти",
  lupin: "люпин",
  molluscs: "молюски",
};

export type DietCode =
  | "vegetarian"
  | "vegan"
  | "pescatarian"
  | "halal"
  | "kosher"
  | "lactose_free"
  | "gluten_free"
  | "dairy_free"
  | "low_carb"
  | "keto"
  | "no_pork"
  | "no_beef"
  | "no_sugar";

export const DIET_LABEL_UK: Record<DietCode, string> = {
  vegetarian: "вегетеріанство",
  vegan: "веганство",
  pescatarian: "пескетаріанство",
  halal: "халяль",
  kosher: "кошер",
  lactose_free: "без лактози",
  gluten_free: "без глютену",
  dairy_free: "без молочного",
  low_carb: "низьковуглеводна",
  keto: "кето",
  no_pork: "без свинини",
  no_beef: "без яловичини",
  no_sugar: "без цукру",
};

export type RestrictionPick =
  | { kind: "allergen"; code: AllergenCode; label: string }
  | { kind: "diet"; code: DietCode; label: string };

export const RESTRICTION_PICKER: ReadonlyArray<RestrictionPick> = [
  ...(Object.entries(ALLERGEN_LABEL_UK) as [AllergenCode, string][]).map(
    ([code, label]): RestrictionPick => ({ kind: "allergen", code, label }),
  ),
  ...(Object.entries(DIET_LABEL_UK) as [DietCode, string][]).map(
    ([code, label]): RestrictionPick => ({ kind: "diet", code, label }),
  ),
];
