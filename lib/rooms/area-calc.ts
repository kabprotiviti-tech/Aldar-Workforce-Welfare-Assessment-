import { areaToM2, isKnownAreaUnit, isKnownLengthUnit, lengthToM } from "@/lib/rooms/units";
import type { FactConfidence } from "@/lib/db/evidence";

/**
 * Computing one room's floor area from what a drawing prints (this
 * prompt: "the model returns printed values only... the calculation is
 * done in code").
 *
 * A room's raw drawing reading, once the assessor has confirmed each
 * individual field through the fact ledger. Every field is exactly what
 * was printed — no field here is itself a computed value.
 */
export interface DrawingRoomReading {
  roomRef: string;
  areaValue: number | null;
  areaUnit: string | null;
  areaConfidence: FactConfidence | null;
  dimensionA: number | null;
  dimensionB: number | null;
  dimensionUnit: string | null;
  dimensionConfidence: FactConfidence | null;
}

export type AreaCalcResult =
  | { ok: true; areaM2: number; confidence: FactConfidence; source: "printed_area" | "printed_dimensions" }
  | { ok: false; reason: string };

/**
 * A printed area figure is preferred over multiplying dimensions,
 * because a printed figure is what the drawing itself states as the
 * room's area — dimensions are the fallback for a drawing that only
 * labels its rooms with a size string. When both are present, this does
 * not cross-check one against the other: comparing them is arithmetic
 * this module doesn't do either, and a mismatch between a room's printed
 * area and its printed dimensions is a question for the assessor
 * reviewing the drawing, not something this function silently resolves.
 */
export function computeRoomAreaM2(reading: DrawingRoomReading): AreaCalcResult {
  if (reading.areaValue !== null && reading.areaUnit !== null) {
    if (!isKnownAreaUnit(reading.areaUnit)) {
      return { ok: false, reason: `"${reading.areaUnit}" is not an area unit this platform can convert.` };
    }
    const areaM2 = areaToM2(reading.areaValue, reading.areaUnit)!;
    if (areaM2 <= 0) return { ok: false, reason: "The printed area is not a positive number." };
    return { ok: true, areaM2, confidence: reading.areaConfidence ?? "low", source: "printed_area" };
  }

  if (reading.dimensionA !== null && reading.dimensionB !== null && reading.dimensionUnit !== null) {
    if (!isKnownLengthUnit(reading.dimensionUnit)) {
      return { ok: false, reason: `"${reading.dimensionUnit}" is not a length unit this platform can convert.` };
    }
    const a = lengthToM(reading.dimensionA, reading.dimensionUnit)!;
    const b = lengthToM(reading.dimensionB, reading.dimensionUnit)!;
    if (a <= 0 || b <= 0) return { ok: false, reason: "A printed dimension is not a positive number." };
    return { ok: true, areaM2: a * b, confidence: reading.dimensionConfidence ?? "low", source: "printed_dimensions" };
  }

  return { ok: false, reason: `No printed area or complete dimension pair for room "${reading.roomRef}".` };
}

/**
 * Whether a computed candidate should be proposed to the assessor at
 * all, or withheld in favour of a manual entry field (this prompt:
 * "degrade honestly... on low confidence, present a manual entry field
 * rather than a guess"). A scanned, rotated or low-resolution drawing
 * frequently produces a low-confidence reading of the *right* field but
 * the *wrong* digits — proposing a number in that state invites an
 * assessor to rubber-stamp a guess.
 */
export function shouldProposeArea(result: AreaCalcResult): boolean {
  return result.ok && result.confidence !== "low";
}
