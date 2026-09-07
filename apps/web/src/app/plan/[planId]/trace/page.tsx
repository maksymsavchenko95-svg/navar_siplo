"use client";

import { use } from "react";

import { trpc } from "@/lib/trpc";
import { TraceView } from "@/components/TraceDrawer";
import { ScreenShell, ScreenTitle, StateBanner } from "@/components/ui";

export default function TracePage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = use(params);
  const trace = trpc.ops.trace.useQuery({ planId });

  const download = () => {
    if (trace.data?.status !== "ok") return;
    const blob = new Blob([JSON.stringify(trace.data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ops-trace-${planId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <ScreenShell step={4} back={`/plan/${planId}`}>
      <ScreenTitle
        title="Як це працювало"
        sub="JSON-RPC виклики до Silpo MCP під час складання плану."
      />
      {trace.data?.status === "not_found" ? (
        <StateBanner title="Трейс не знайдено">
          Для цього плану немає збережених викликів.
        </StateBanner>
      ) : (
        <TraceView
          calls={trace.data?.status === "ok" ? trace.data.calls : undefined}
          summary={trace.data?.status === "ok" ? trace.data.summary : undefined}
          loading={trace.isLoading}
          onExport={download}
        />
      )}
    </ScreenShell>
  );
}
