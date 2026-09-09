"use client";

import { use } from "react";
import { useRouter } from "next/navigation";

import { trpc } from "@/lib/trpc";
import { minutes, unitLabel } from "@/lib/format";
import { ScreenShell, ScreenTitle, SpinnerDots, StateBanner } from "@/components/ui";

const DISCLAIMER =
  "Navar не є медичним сервісом. За критичних алергій перевіряйте склад на упаковці.";

const DIFFICULTY_UK = ["", "просто", "середньо", "складно"];

export default function DayRecipePage({
  params,
}: {
  params: Promise<{ planId: string; dayIndex: string }>;
}) {
  const { planId, dayIndex } = use(params);
  const router = useRouter();
  const day = Number(dayIndex);
  const q = trpc.plan.recipe.useQuery({ planId, day });

  const back = `/plan/${planId}`;

  if (q.isLoading) {
    return (
      <ScreenShell step={4} back={back}>
        <SpinnerDots />
      </ScreenShell>
    );
  }

  if (q.data?.status === "not_found") {
    return (
      <ScreenShell step={4} back={back}>
        <StateBanner title="План не знайдено">
          <button onClick={() => router.push("/plans")}>До планів</button>
        </StateBanner>
      </ScreenShell>
    );
  }

  if (q.data?.status === "recipe_unavailable") {
    return (
      <ScreenShell step={4} back={back}>
        <ScreenTitle title={q.data.titleUk} sub={`День ${q.data.dayIndex}`} />
        <StateBanner tone="warn" title="Рецепт більше недоступний">
          Цю страву прибрали з каталогу. Список покупок для неї лишається в плані.
        </StateBanner>
      </ScreenShell>
    );
  }

  if (q.data?.status !== "ok") {
    return (
      <ScreenShell step={4} back={back}>
        <SpinnerDots />
      </ScreenShell>
    );
  }

  const r = q.data.recipe;
  const m = r.macrosPerServing;

  return (
    <ScreenShell step={4} back={back}>
      <ScreenTitle
        title={r.titleUk}
        sub={`День ${r.dayIndex} · порцій: ${r.servings}${
          r.portionScale !== 1 ? ` · порція ×${r.portionScale.toFixed(2)}` : ""
        }`}
      />

      <div className="dish-meta-row">
        {r.totalMinutes != null && (
          <span className="dish-pill-meta">{minutes(r.totalMinutes)}</span>
        )}
        {r.difficulty != null && (
          <span className="dish-pill-meta">{DIFFICULTY_UK[r.difficulty] ?? ""}</span>
        )}
        {m && (
          <span className="dish-pill-protein">
            {Math.round(m.kcal)} ккал · {Math.round(m.protein)} г білка · за порцію
          </span>
        )}
      </div>

      <div className="recipe-block">
        <div className="cart-group-title">Продукти на {r.servings} порц.</div>
        <ul className="recipe-ingredients">
          {r.ingredients.map((ing) => (
            <li key={ing.nameUk} className="recipe-ingredient-row">
              <span>
                {ing.nameUk}
                {ing.optional && <span className="recipe-ingredient-opt"> · за бажанням</span>}
              </span>
              <span className="recipe-ingredient-amount">
                {ing.amount} {unitLabel(ing.unit)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="recipe-block">
        <div className="cart-group-title">Приготування</div>
        <ol className="recipe-steps">
          {r.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </div>

      {r.allergens.length > 0 && (
        <p className="screen-sub-title">Алергени: {r.allergens.join(", ")}</p>
      )}
      <p className="cart-retailer-note">{DISCLAIMER}</p>
    </ScreenShell>
  );
}
