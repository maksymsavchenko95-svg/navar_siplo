import { HelloCard } from "@/components/HelloCard";
import { McpStatus } from "@/components/McpStatus";
import { RecipesSection } from "@/components/RecipesSection";

export default function HomePage() {
  return (
    <main style={{ display: "grid", gap: 28 }}>
      <h1>Navar</h1>
      <HelloCard />
      <RecipesSection />
      <McpStatus />
    </main>
  );
}
