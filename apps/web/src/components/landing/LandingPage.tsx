import { DifferentiationSection } from "./DifferentiationSection";
import { ExistingToolsSection } from "./ExistingToolsSection";
import { FaqSection } from "./FaqSection";
import { FinalCtaSection } from "./FinalCtaSection";
import { HeroSection } from "./HeroSection";
import { HowItWorksSection } from "./HowItWorksSection";
import { LandingFooter } from "./LandingFooter";
import { LandingHeader } from "./LandingHeader";
import { ProblemSection } from "./ProblemSection";
import { SafetySection } from "./SafetySection";
import { StatsBand } from "./StatsBand";
import { TrustEngineeringSection } from "./TrustEngineeringSection";

/**
 * The public marketing landing page shown to a Guest with no session (`SessionGate`).
 * Ported from `designs/navar_design/src/components/LandingPage.tsx` + its `landing/*`
 * sections — full-width, standalone (no phone frame / pitch columns, unlike the
 * authenticated app's `PresentationShell`).
 */
export function LandingPage({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="landing-page-root">
      <LandingHeader onLogin={onLogin} />
      <main id="main-content">
        <HeroSection onLogin={onLogin} />
        <StatsBand />
        <ProblemSection />
        <ExistingToolsSection />
        <HowItWorksSection />
        <DifferentiationSection />
        <TrustEngineeringSection />
        <SafetySection />
        <FaqSection />
        <FinalCtaSection onLogin={onLogin} />
      </main>
      <LandingFooter />
    </div>
  );
}
