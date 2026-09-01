"use client";

import type { RecipeSummary } from "@navar/domain";

export function RecipeList({
  recipes,
  selectedId,
  onSelect,
}: {
  recipes: RecipeSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
      {recipes.map((r) => {
        const selected = r.id === selectedId;
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onSelect(r.id)}
              aria-pressed={selected}
              style={{
                width: "100%",
                textAlign: "left",
                cursor: "pointer",
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${selected ? "#111" : "#ddd"}`,
                background: selected ? "#111" : "#fff",
                color: selected ? "#fff" : "inherit",
                font: "inherit",
              }}
            >
              <strong>{r.title}</strong>
              <span style={{ opacity: 0.7 }}>
                {" "}
                — {r.servings} порц. · {r.totalMinutes} хв
                {r.macros
                  ? ` · ${Math.round(r.macros.kcal)} ккал / ${Math.round(r.macros.protein)} г білка`
                  : ""}
              </span>
              <div style={{ fontSize: 13, opacity: selected ? 0.85 : 0.6, marginTop: 2 }}>
                {r.ingredients.join(", ")}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
