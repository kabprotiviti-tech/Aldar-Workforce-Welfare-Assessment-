import { computeRoomAreaM2, shouldProposeArea } from "@/lib/rooms/area-calc";
import { groupConfidence, groupFactsByRef, groupNumberValue, groupStringValue, type GroupedFact } from "@/lib/rooms/group-facts";

/**
 * Turning a batch of confirmed extraction facts into per-room proposals
 * (this prompt: extraction produces printed values; this is where they
 * become one candidate area per room, in code, never in the model).
 *
 * Pure over the fact list — no database. The adapter is
 * lib/rooms/propose-supabase.ts, and the actual write is a single SQL
 * function (propose_room_measurements, 0027_room_area.sql) so "never
 * overwrite a value a person has already confirmed" is enforced by the
 * write itself rather than by every caller remembering to check first.
 */

const DRAWING_FACT_KEYS = [
  "drawing_room_ref",
  "drawing_room_area_value",
  "drawing_room_area_unit",
  "drawing_room_dimension_a",
  "drawing_room_dimension_b",
  "drawing_room_dimension_unit",
] as const;

const OCCUPANCY_FACT_KEYS = ["occupancy_room_ref", "occupancy_headcount"] as const;

export interface RoomMeasurementProposal {
  roomRef: string;
  /** Null when nothing proposable was found, or when a candidate existed but its confidence was too low to propose. */
  drawingAreaM2: number | null;
  /** True when a candidate was computed but withheld — the room the review screen should offer a manual field for, distinct from a room the drawing never mentioned. */
  lowConfidence: boolean;
  /** Whatever this run computed, for the caller to explain a low-confidence withholding if it wants to. */
  candidateReason: string | null;
  scheduleOccupancyHeadcount: number | null;
}

/**
 * Groups the drawing's six per-room fact keys and computes one area
 * candidate per room. A room the drawing mentions but that has no
 * usable area/dimension reading at all (every field absent, or an
 * unrecognised unit) contributes no proposal — there is nothing to
 * withhold, because nothing was computed.
 */
function drawingProposals(facts: readonly GroupedFact[]): Map<string, { areaM2: number | null; lowConfidence: boolean; reason: string | null }> {
  const groups = groupFactsByRef(facts, DRAWING_FACT_KEYS);
  const result = new Map<string, { areaM2: number | null; lowConfidence: boolean; reason: string | null }>();

  for (const [roomRef, group] of groups) {
    const computed = computeRoomAreaM2({
      roomRef,
      areaValue: groupNumberValue(group, "drawing_room_area_value"),
      areaUnit: groupStringValue(group, "drawing_room_area_unit"),
      areaConfidence: groupConfidence(group, "drawing_room_area_value"),
      dimensionA: groupNumberValue(group, "drawing_room_dimension_a"),
      dimensionB: groupNumberValue(group, "drawing_room_dimension_b"),
      dimensionUnit: groupStringValue(group, "drawing_room_dimension_unit"),
      dimensionConfidence: groupConfidence(group, "drawing_room_dimension_a"),
    });

    if (!computed.ok) {
      result.set(roomRef, { areaM2: null, lowConfidence: false, reason: computed.reason });
      continue;
    }

    result.set(roomRef, {
      areaM2: shouldProposeArea(computed) ? computed.areaM2 : null,
      lowConfidence: !shouldProposeArea(computed),
      reason: shouldProposeArea(computed) ? null : "The drawing's reading for this room was low confidence.",
    });
  }

  return result;
}

function scheduleOccupancies(facts: readonly GroupedFact[]): Map<string, number | null> {
  const groups = groupFactsByRef(facts, OCCUPANCY_FACT_KEYS);
  const result = new Map<string, number | null>();
  for (const [roomRef, group] of groups) {
    result.set(roomRef, groupNumberValue(group, "occupancy_headcount"));
  }
  return result;
}

/** One proposal per room mentioned by either the drawing or the occupancy schedule. */
export function proposeRoomMeasurements(facts: readonly GroupedFact[]): RoomMeasurementProposal[] {
  const drawing = drawingProposals(facts);
  const schedule = scheduleOccupancies(facts);

  const roomRefs = new Set([...drawing.keys(), ...schedule.keys()]);

  return [...roomRefs].sort().map((roomRef) => {
    const area = drawing.get(roomRef) ?? { areaM2: null, lowConfidence: false, reason: null };
    return {
      roomRef,
      drawingAreaM2: area.areaM2,
      lowConfidence: area.lowConfidence,
      candidateReason: area.reason,
      scheduleOccupancyHeadcount: schedule.get(roomRef) ?? null,
    };
  });
}
