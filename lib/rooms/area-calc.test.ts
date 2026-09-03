import { describe, expect, it } from "vitest";
import { computeRoomAreaM2, shouldProposeArea, type DrawingRoomReading } from "@/lib/rooms/area-calc";

function reading(overrides: Partial<DrawingRoomReading> = {}): DrawingRoomReading {
  return {
    roomRef: "Room 204",
    areaValue: null,
    areaUnit: null,
    areaConfidence: null,
    dimensionA: null,
    dimensionB: null,
    dimensionUnit: null,
    dimensionConfidence: null,
    ...overrides,
  };
}

describe("computeRoomAreaM2", () => {
  it("uses the printed area value directly when it's already in square metres", () => {
    const result = computeRoomAreaM2(reading({ areaValue: 26.4, areaUnit: "m2", areaConfidence: "high" }));
    expect(result).toEqual({ ok: true, areaM2: 26.4, confidence: "high", source: "printed_area" });
  });

  it("converts a printed area value in square feet", () => {
    const result = computeRoomAreaM2(reading({ areaValue: 284.2, areaUnit: "sq ft", areaConfidence: "medium" }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.areaM2).toBeCloseTo(26.41, 1);
  });

  it("multiplies printed dimensions in code, never trusting the model to have done it", () => {
    const result = computeRoomAreaM2(reading({ dimensionA: 6.2, dimensionB: 4.1, dimensionUnit: "m", dimensionConfidence: "high" }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.areaM2).toBeCloseTo(25.42, 2);
    expect(result.ok && result.confidence).toBe("high");
    expect(result.ok && result.source).toBe("printed_dimensions");
  });

  it("converts dimensions in millimetres before multiplying", () => {
    const result = computeRoomAreaM2(reading({ dimensionA: 6200, dimensionB: 4100, dimensionUnit: "mm", dimensionConfidence: "high" }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.areaM2).toBeCloseTo(25.42, 2);
  });

  it("prefers a printed area value over printed dimensions, without comparing them", () => {
    const result = computeRoomAreaM2(
      reading({ areaValue: 30, areaUnit: "m2", areaConfidence: "high", dimensionA: 6.2, dimensionB: 4.1, dimensionUnit: "m", dimensionConfidence: "high" }),
    );
    expect(result).toEqual({ ok: true, areaM2: 30, confidence: "high", source: "printed_area" });
  });

  it("is insufficient when only one dimension is printed", () => {
    const result = computeRoomAreaM2(reading({ dimensionA: 6.2, dimensionUnit: "m" }));
    expect(result).toEqual({ ok: false, reason: 'No printed area or complete dimension pair for room "Room 204".' });
  });

  it("is insufficient when nothing at all was printed", () => {
    expect(computeRoomAreaM2(reading())).toEqual({ ok: false, reason: 'No printed area or complete dimension pair for room "Room 204".' });
  });

  it("refuses an area unit it does not recognise, rather than guessing at a conversion", () => {
    const result = computeRoomAreaM2(reading({ areaValue: 26, areaUnit: "arpent", areaConfidence: "high" }));
    expect(result).toEqual({ ok: false, reason: '"arpent" is not an area unit this platform can convert.' });
  });

  it("refuses a dimension unit it does not recognise", () => {
    const result = computeRoomAreaM2(reading({ dimensionA: 6, dimensionB: 4, dimensionUnit: "cubit" }));
    expect(result).toEqual({ ok: false, reason: '"cubit" is not a length unit this platform can convert.' });
  });

  it("rejects a non-positive printed area", () => {
    const result = computeRoomAreaM2(reading({ areaValue: 0, areaUnit: "m2", areaConfidence: "high" }));
    expect(result).toEqual({ ok: false, reason: "The printed area is not a positive number." });
  });

  it("rejects a non-positive printed dimension", () => {
    const result = computeRoomAreaM2(reading({ dimensionA: 6, dimensionB: -1, dimensionUnit: "m" }));
    expect(result).toEqual({ ok: false, reason: "A printed dimension is not a positive number." });
  });

  it("defaults to low confidence when the source fact carried none", () => {
    const result = computeRoomAreaM2(reading({ areaValue: 26.4, areaUnit: "m2" }));
    expect(result.ok && result.confidence).toBe("low");
  });
});

describe("shouldProposeArea", () => {
  it("proposes a high or medium confidence result", () => {
    expect(shouldProposeArea({ ok: true, areaM2: 26.4, confidence: "high", source: "printed_area" })).toBe(true);
    expect(shouldProposeArea({ ok: true, areaM2: 26.4, confidence: "medium", source: "printed_area" })).toBe(true);
  });

  it("withholds a low-confidence result rather than proposing a guess", () => {
    expect(shouldProposeArea({ ok: true, areaM2: 26.4, confidence: "low", source: "printed_area" })).toBe(false);
  });

  it("withholds a failed computation", () => {
    expect(shouldProposeArea({ ok: false, reason: "nothing printed" })).toBe(false);
  });
});
