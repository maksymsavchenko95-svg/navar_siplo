import type { McpCallRecord } from "@navar/retail";
import { describe, expect, it, vi } from "vitest";

import type { BootstrapReader } from "../household/bootstrap-job.js";
import { runBootstrapJob } from "./bootstrap-handler.js";

const noop = () => undefined as never;

function deps(over: Partial<Parameters<typeof runBootstrapJob>[1]> = {}) {
  return {
    getProvider: (id: string) => ({ __household: id }) as unknown as BootstrapReader,
    getLlm: noop,
    getLlmTracer: noop,
    db: {} as never,
    runBootstrap: vi.fn(async () => ({ outcome: "done", orderCount: 3 }) as const),
    persistTrace: vi.fn(async (_r: readonly McpCallRecord[]) => {}),
    ...over,
  };
}

describe("runBootstrapJob", () => {
  it("resolves the provider for the job's own household, not a process-wide one", async () => {
    const seen: string[] = [];
    const d = deps({ getProvider: (id) => ({ __household: id }) as unknown as BootstrapReader });
    const runBootstrap = vi.fn(async (_hh: string, b: { reader: BootstrapReader }) => {
      seen.push((b.reader as unknown as { __household: string }).__household);
      return { outcome: "done", orderCount: 1 } as const;
    });

    await runBootstrapJob("hh-web-42", { ...d, runBootstrap });

    expect(runBootstrap).toHaveBeenCalledWith("hh-web-42", expect.anything());
    expect(seen).toEqual(["hh-web-42"]);
  });

  it("persists the MCP trace under the job's household and returns the result", async () => {
    const d = deps();
    const res = await runBootstrapJob("hh-1", d);

    expect(res).toEqual({ outcome: "done", orderCount: 3 });
    expect(d.persistTrace).toHaveBeenCalledWith(expect.any(Array), {
      householdId: "hh-1",
      phase: "bootstrap",
    });
  });
});
