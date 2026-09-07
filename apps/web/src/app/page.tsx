"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { trpc } from "@/lib/trpc";
import { SpinnerDots } from "@/components/ui";

/**
 * Entry redirect. Session is already guaranteed by `<SessionGate>`. Existing plans → the
 * plan history (useful for the "same seed → same plan" demo); otherwise start the wizard.
 */
export default function HomePage() {
  const router = useRouter();
  const plans = trpc.plan.list.useQuery();

  useEffect(() => {
    if (plans.isLoading) return;
    router.replace(plans.data && plans.data.length > 0 ? "/plans" : "/goal");
  }, [plans.isLoading, plans.data, router]);

  return (
    <div className="screen-wrapper">
      <div
        className="app-content"
        style={{ alignItems: "center", justifyContent: "center", flex: 1 }}
      >
        <SpinnerDots />
      </div>
    </div>
  );
}
