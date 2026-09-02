import { describe, expect, it } from "vitest";
import { computeCostUsd } from "./cost";

describe("computeCostUsd", () => {
  it("computes cost from the documented per-million rates", () => {
    // 1M input tokens ($3.00) + 1M output tokens ($15.00) = $18.00.
    expect(computeCostUsd(1_000_000, 1_000_000)).toBe(18);
  });

  it("computes a realistic small-document cost", () => {
    // 2,000 input tokens + 500 output tokens.
    expect(computeCostUsd(2000, 500)).toBeCloseTo(0.006 + 0.0075, 6);
  });

  it("returns 0 for a zero-token call", () => {
    expect(computeCostUsd(0, 0)).toBe(0);
  });
});
