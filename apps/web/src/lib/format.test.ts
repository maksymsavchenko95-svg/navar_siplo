import { describe, expect, it } from "vitest";

import {
  approx,
  groupNumber,
  MINUS,
  minutes,
  NBSP,
  pct,
  planTimestamp,
  pluralPeople,
  signedUah,
  THIN_SPACE,
  uah,
  unitLabel,
} from "./format";

describe("groupNumber", () => {
  it("groups thousands with a narrow no-break space", () => {
    expect(groupNumber(2340)).toBe(`2${THIN_SPACE}340`);
    expect(groupNumber(999)).toBe("999");
    expect(groupNumber(1234567)).toBe(`1${THIN_SPACE}234${THIN_SPACE}567`);
  });

  it("keeps a non-zero fraction, drops a zero one", () => {
    expect(groupNumber(12.5, 2)).toBe("12,50");
    expect(groupNumber(12.0, 2)).toBe("12");
  });

  it("uses a real minus sign for negatives", () => {
    expect(groupNumber(-240)).toBe(`${MINUS}240`);
  });

  it("returns an em dash for non-finite input", () => {
    expect(groupNumber(Number.NaN)).toBe("—");
  });
});

describe("uah", () => {
  it("appends the sign after a no-break space", () => {
    expect(uah(2340)).toBe(`2${THIN_SPACE}340${NBSP}₴`);
  });
  it("maps null / undefined to an em dash", () => {
    expect(uah(null)).toBe("—");
    expect(uah(undefined)).toBe("—");
  });
});

describe("signedUah", () => {
  it("prefixes a plus for gains and a minus for cuts", () => {
    expect(signedUah(180)).toBe(`+180${NBSP}₴`);
    expect(signedUah(-240)).toBe(`${MINUS}240${NBSP}₴`);
  });
  it("says 'без змін' for zero / nullish", () => {
    expect(signedUah(0)).toBe("без змін");
    expect(signedUah(null)).toBe("без змін");
  });
});

describe("pct / minutes / approx", () => {
  it("rounds a percentage and spaces the sign", () => {
    expect(pct(37.4)).toBe(`37${NBSP}%`);
    expect(pct(null)).toBe("—");
  });
  it("formats cook time", () => {
    expect(minutes(45)).toBe(`45${NBSP}хв`);
  });
  it("prefixes an approx marker", () => {
    expect(approx(uah(2340))).toBe(`≈${NBSP}2${THIN_SPACE}340${NBSP}₴`);
  });
});

describe("planTimestamp", () => {
  it("renders a local date + time with a genitive month name", () => {
    // build from local components so the assertion is TZ-independent
    const iso = new Date(2026, 8, 8, 14, 32).toISOString();
    expect(planTimestamp(iso)).toBe("8 вересня, 14:32");
  });
  it("zero-pads hours and minutes", () => {
    const iso = new Date(2026, 0, 9, 9, 5).toISOString();
    expect(planTimestamp(iso)).toBe("9 січня, 09:05");
  });
  it("returns — for an unparseable string", () => {
    expect(planTimestamp("not-a-date")).toBe("—");
  });
});

describe("pluralPeople", () => {
  it("uses the Ukrainian count forms", () => {
    expect([1, 2, 3, 4, 5, 11, 12, 21, 22].map(pluralPeople)).toEqual([
      "1 особу",
      "2 особи",
      "3 особи",
      "4 особи",
      "5 осіб",
      "11 осіб",
      "12 осіб",
      "21 особу",
      "22 особи",
    ]);
  });
});

describe("unitLabel", () => {
  it("maps every recipe unit to a Ukrainian short label", () => {
    expect(["g", "ml", "pcs", "kg", "l"].map(unitLabel)).toEqual(["г", "мл", "шт", "кг", "л"]);
  });
  it("passes an unknown unit through unchanged", () => {
    expect(unitLabel("tbsp")).toBe("tbsp");
  });
});
