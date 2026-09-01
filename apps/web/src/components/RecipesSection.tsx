"use client";

import { useState } from "react";

import { trpc } from "@/lib/trpc";
import { RecipeList } from "./RecipeList";
import { RecipeShopping } from "./RecipeShopping";

export function RecipesSection() {
  const recipes = trpc.recipes.list.useQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = recipes.data?.find((r) => r.id === selectedId) ?? null;

  return (
    <section>
      <h2>Рецепти</h2>
      {recipes.data?.length ? (
        <div style={{ display: "grid", gap: 16 }}>
          <RecipeList recipes={recipes.data} selectedId={selectedId} onSelect={setSelectedId} />
          {selected && (
            <div
              style={{
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: "12px 14px",
              }}
            >
              <h3 style={{ margin: "0 0 8px" }}>Купити для «{selected.title}»</h3>
              <RecipeShopping recipeId={selected.id} />
            </div>
          )}
        </div>
      ) : (
        <p>{recipes.isLoading ? "…" : "Немає рецептів — запусти `pnpm db:seed`."}</p>
      )}
    </section>
  );
}
