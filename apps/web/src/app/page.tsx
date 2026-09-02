import { HelloCard } from "@/components/HelloCard";
import { HouseholdPortrait } from "@/components/HouseholdPortrait";
import { RecipesSection } from "@/components/RecipesSection";

export default function HomePage() {
  return (
    <main style={{ display: "grid", gap: 28 }}>
      <h1>Navar</h1>
      <HelloCard />
      <HouseholdPortrait />
      <RecipesSection />
    </main>
  );
}
