import { HelloCard } from "@/components/HelloCard";
import { HouseholdPortrait } from "@/components/HouseholdPortrait";
import { RecipesSection } from "@/components/RecipesSection";

/**
 * M0/M1 scaffolding parked here so it stays reachable for debugging without cluttering the
 * P0 wizard. Not linked from the app.
 */
export default function DevPage() {
  return (
    <main style={{ display: "grid", gap: 28, padding: 16 }}>
      <h1>Navar — dev</h1>
      <HelloCard />
      <HouseholdPortrait />
      <RecipesSection />
    </main>
  );
}
