"use client";

import { trpc } from "@/lib/trpc";

export function RecipeShopping({ recipeId }: { recipeId: string }) {
  const q = trpc.recipes.skuCandidates.useQuery({ recipeId });

  if (q.isLoading) return <p style={{ opacity: 0.6 }}>Шукаю товари в Сільпо…</p>;
  if (!q.data) return <p style={{ opacity: 0.6 }}>—</p>;

  if (q.data.status === "auth_required") return <p>Не підключено до Сільпо MCP — {q.data.hint}.</p>;
  if (q.data.status === "no_cart") return <p>{q.data.hint}.</p>;
  if (q.data.status === "error")
    return <p style={{ color: "#b00" }}>Помилка Сільпо MCP: {q.data.message}</p>;

  const { items, totalUah, matchedCount } = q.data;
  return (
    <div>
      <p style={{ margin: "0 0 8px" }}>
        Знайдено {matchedCount} з {items.length} · орієнтовно <strong>{totalUah} ₴</strong>{" "}
        <span style={{ opacity: 0.6 }}>
          (перший збіг на кожен інгредієнт — не фінальний мапінг)
        </span>
      </p>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
        {items.map((it) => (
          <li
            key={it.ingredient}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              padding: "6px 0",
              borderBottom: "1px solid #eee",
            }}
          >
            {it.match?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={it.match.imageUrl}
                alt=""
                width={40}
                height={40}
                style={{ objectFit: "contain", flex: "none" }}
              />
            ) : (
              <span style={{ width: 40, flex: "none" }} />
            )}
            <span style={{ flex: "none", width: 130, opacity: 0.7 }}>{it.ingredient}</span>
            {it.match ? (
              <span style={{ flex: 1 }}>
                {it.match.name}
                {it.match.packSize ? ` · ${it.match.packSize}` : ""}
                {!it.match.inStock ? " · немає в наявності" : ""}
              </span>
            ) : (
              <span style={{ flex: 1, opacity: 0.5 }}>нічого не знайдено</span>
            )}
            <span style={{ flex: "none", fontVariantNumeric: "tabular-nums" }}>
              {it.match ? `${it.match.price} ₴` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
