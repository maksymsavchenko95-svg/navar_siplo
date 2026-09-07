"use client";

import type { McpCall, OpsTraceSummary } from "@navar/domain";

import { SpinnerDots } from "@/components/ui";

/**
 * Renders an MCP call trace (`ops.trace` / `ops.bootstrapTrace`, `AC-P0-08`). Rows grouped by
 * `correlationId`, newest run first, so a warm all-`cached` run doesn't hide the cold one.
 */
export function TraceView({
  calls,
  summary,
  loading,
  onExport,
}: {
  calls: McpCall[] | undefined;
  summary: OpsTraceSummary | undefined;
  loading: boolean;
  onExport?: () => void;
}) {
  if (loading) return <SpinnerDots />;
  if (!calls || calls.length === 0) {
    return (
      <p className="screen-sub-title">Трейс порожній — згенеруйте план на «холодному» процесі.</p>
    );
  }

  // newest correlation id (by first startedAt) first
  const order = new Map<string, number>();
  for (const c of calls) {
    const t = Date.parse(c.startedAt);
    if (!order.has(c.correlationId) || t < order.get(c.correlationId)!) {
      order.set(c.correlationId, t);
    }
  }
  const groups = [...order.entries()].sort((a, b) => b[1] - a[1]).map(([cid]) => cid);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {onExport && (
        <button type="button" className="btn-secondary" onClick={onExport}>
          Експорт JSON
        </button>
      )}
      {groups.map((cid) => {
        const rows = calls.filter((c) => c.correlationId === cid);
        return (
          <div key={cid} className="trace-drawer">
            <div
              className="trace-drawer__summary"
              style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}
            >
              {cid.slice(0, 8)} — {rows.length} викликів
            </div>
            {rows.map((c, i) => (
              <div
                key={`${cid}-${i}`}
                className={`trace-drawer__row ${c.status === "error" ? "trace-drawer__row--error" : ""}`}
              >
                <span>{c.phase}</span>
                <span className={c.cached ? "trace-drawer__cached" : ""}>{c.tool}</span>
                <span>
                  {c.durationMs} ms{c.attempts > 1 ? ` ×${c.attempts}` : ""}
                </span>
                <span>{c.cached ? "cache" : c.status}</span>
              </div>
            ))}
          </div>
        );
      })}
      {summary && (
        <div className="trace-drawer">
          <div
            className="trace-drawer__summary"
            style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}
          >
            {summary.totalCalls} викликів · {summary.okCalls} ok / {summary.errorCalls} помилок ·{" "}
            {summary.cachedCalls} з кешу · {summary.totalDurationMs} ms
          </div>
          {Object.entries(summary.byTool).map(([tool, s]) => (
            <div key={tool} className="trace-drawer__row">
              <span>{tool}</span>
              <span />
              <span>{s.count}×</span>
              <span>{s.durationMs} ms</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
