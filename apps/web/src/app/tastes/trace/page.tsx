"use client";

import { trpc } from "@/lib/trpc";
import { TraceView } from "@/components/TraceDrawer";
import { ScreenShell, ScreenTitle } from "@/components/ui";

export default function BootstrapTracePage() {
  const trace = trpc.ops.bootstrapTrace.useQuery();

  const download = () => {
    if (trace.data?.status !== "ok") return;
    const blob = new Blob([JSON.stringify(trace.data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ops-bootstrap-trace.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <ScreenShell step={3} back="/tastes">
      <ScreenTitle
        title="Як це працювало"
        sub="JSON-RPC виклики до Silpo MCP під час читання вашого профілю та чеків."
      />
      <TraceView
        calls={trace.data?.status === "ok" ? trace.data.calls : undefined}
        summary={trace.data?.status === "ok" ? trace.data.summary : undefined}
        loading={trace.isLoading}
        onExport={download}
      />
    </ScreenShell>
  );
}
