import { describe, expect, it } from "vitest";
import { formatPercent, masteryBand } from "@/lib/utils";

describe("formatPercent", () => {
  it("renders a 0..1 ratio as a whole percentage", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.5)).toBe("50%");
    expect(formatPercent(1)).toBe("100%");
  });

  it("respects the requested precision", () => {
    expect(formatPercent(0.876, 1)).toBe("87.6%");
  });
});

describe("masteryBand", () => {
  it("classifies low mastery as needing attention", () => {
    expect(masteryBand(0)).toBe("low");
    expect(masteryBand(0.49)).toBe("low");
  });

  it("treats the 0.5 boundary as mid", () => {
    expect(masteryBand(0.5)).toBe("mid");
    expect(masteryBand(0.749)).toBe("mid");
  });

  it("treats 0.75 and above as high", () => {
    expect(masteryBand(0.75)).toBe("high");
    expect(masteryBand(1)).toBe("high");
  });
});
