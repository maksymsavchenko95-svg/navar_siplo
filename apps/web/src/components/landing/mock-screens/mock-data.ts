/**
 * Static sample data for the landing page's "how it works" mini phone mockups
 * (`apps/web/src/components/landing/mock-screens/*`). Illustrative only — not wired to
 * `@navar/db` or tRPC. Ported from `designs/navar_design/src/mockData.ts`.
 */

export const MOCK_GOAL_CARDS = [
  {
    id: "routine",
    title: "Рутина",
    subtitle: "Меню й закупівля для родини",
    description:
      "Збалансовані вечері на весь тиждень з урахуванням смаків кожного члена сім'ї та бюджету.",
  },
  {
    id: "form",
    title: "Форма",
    subtitle: "Меню під нутрієнтну ціль",
    description:
      "Точний розрахунок білка та калорійного коридору з простих продуктів без зайвих витрат.",
  },
] as const;

export const MOCK_NUMBERS_FORM = {
  budget: 2400,
  budgetMin: 1200,
  budgetMax: 6000,
  gender: "Ч" as const,
  age: 34,
  weight: 78,
  height: 181,
  activity: "Середня" as const,
  direction: "Утримання" as const,
  computedProtein: 135,
  computedCalories: 2250,
};

export const MOCK_TASTES = {
  oftenBought: ["Куряче філе", "Гречка", "Сир кисломолочний", "Яйця", "Броколі", "Йогурт"],
  rarelyBought: ["Риба", "Печінка", "Гриби"],
  allergies: ["Лактоза"],
};

export const MOCK_PLAN_DATA = {
  totalSpent: 2340,
  totalBudget: 2400,
  savedPromo: 310,
  proteinRange: "137–148 г щодня",
  conflictNotice:
    "На 240 ₴ більше за бюджет, інакше не набирається 135 г білка. Показали найближчий варіант.",
  days: [
    { key: "mon", label: "Пн" },
    { key: "tue", label: "Вт" },
    { key: "wed", label: "Ср" },
    { key: "thu", label: "Чт" },
    { key: "fri", label: "Пт" },
  ],
  dishes: [
    {
      id: "d1",
      name: "Курка з гречкою та броколі",
      cookTime: "25 хв",
      price: 410,
      protein: 142,
      isPromo: true,
    },
    {
      id: "d2",
      name: "Запечена індичка з булгуром",
      cookTime: "35 хв",
      price: 490,
      protein: 146,
      isPromo: false,
    },
    {
      id: "d3",
      name: "Сирники з йогуртом і горіхами",
      cookTime: "20 хв",
      price: 360,
      protein: 138,
      isPromo: true,
    },
    {
      id: "d4",
      name: "Тушкована квасоля з яловичиною",
      cookTime: "40 хв",
      price: 580,
      protein: 148,
      isPromo: false,
    },
  ],
};

export interface MockCartProduct {
  id: string;
  name: string;
  packSize: string;
  quantity: number;
  price: number;
  isPromo?: boolean;
  isReplacement?: boolean;
  replacementNote?: string;
  replacementOriginal?: string;
}

export const MOCK_CART_ITEMS: MockCartProduct[] = [
  {
    id: "p1",
    name: "Філе куряче охолоджене «Наша Ряба»",
    packSize: "850 г",
    quantity: 2,
    price: 318,
    isPromo: true,
  },
  {
    id: "p2",
    name: "Крупа гречана ядриця «Премія»",
    packSize: "1 кг",
    quantity: 1,
    price: 58,
  },
  {
    id: "p3",
    name: "Сир кисломолочний 5% «Яготинський»",
    packSize: "400 г",
    quantity: 3,
    price: 264,
    isPromo: true,
  },
  {
    id: "p4",
    name: "Капуста броколі свіжа вагове",
    packSize: "700 г",
    quantity: 1,
    price: 112,
  },
  {
    id: "p5",
    name: "Філе тунця у власному соку «Rio Mare»",
    packSize: "160 г",
    quantity: 2,
    price: 248,
    isReplacement: true,
    replacementNote: "Немає в наявності, замінили на схоже",
    replacementOriginal: "Замість Calvo у власному соку 160 г",
  },
];

export const MOCK_CART_SUMMARY = {
  subtotal: 2340,
  bonuses: 120,
  retailerNotice: "Оформлення відбудеться в застосунку «Сільпо»",
};
