import { describe, expect, it } from "vitest";

import {
  approx,
  groupNumber,
  MINUS,
  minutes,
  NBSP,
  pct,
  signedUah,
  THIN_SPACE,
  uah,
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
