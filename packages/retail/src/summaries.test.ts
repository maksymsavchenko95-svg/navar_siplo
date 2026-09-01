import { describe, expect, it } from "vitest";

import { toToolSummaries } from "./summaries.js";

describe("toToolSummaries", () => {
  it("trims to name+description, nulls missing descriptions, sorts by name", () => {
    expect(
      toToolSummaries([
        { name: "silpo_get_time_slots", description: "slots" },
        { name: "silpo_find_address" },
      ]),
    ).toEqual([
      { name: "silpo_find_address", description: null },
      { name: "silpo_get_time_slots", description: "slots" },
    ]);
  });
});
