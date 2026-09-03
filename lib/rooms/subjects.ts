/**
 * Turning one room's confirmed state into the rule engine's input shape
 * (this prompt's own acceptance criterion, read literally: "no m² per
 * person value can exist without a confirmed area AND a confirmed
 * occupancy; the field is null and the rule returns insufficient_data
 * otherwise").
 *
 * Pure, and deliberately the only place this gating logic lives: R18_ROOM_AREA
 * and R18_ROOM_HEADCOUNT (lib/rules/compliance/rules/accommodation.ts)
 * read whatever `quantitative.room_area_m2`/`room_occupancy` they are
 * given and have no idea whether it came from a drawing, a tape measure,
 * or a schedule — that decision, and the withholding of a value that
 * hasn't been confirmed, happens once, here.
 */

export interface RoomRow {
  roomRef: string;
  areaConfirmedAt: string | null;
  measuredAreaM2: number | null;
  drawingAreaM2: number | null;
  occupancyConfirmedAt: string | null;
  occupancyCount: number | null;
  occupancySource: "physical_count" | "schedule" | null;
  /** The occupancy schedule's own confirmed figure — informational until promoted to occupancyCount. */
  scheduleOccupancyHeadcount: number | null;
}

/**
 * The quantitative fields a room contributes to a rule run. An
 * unconfirmed area or occupancy contributes nothing at all — not a
 * zero, not the unconfirmed number — so R18_ROOM_AREA sees an absent key
 * and returns insufficient_data exactly as it does for any other
 * missing input.
 */
export function roomQuantitative(room: RoomRow): Record<string, number> {
  const quantitative: Record<string, number> = {};

  if (room.areaConfirmedAt !== null) {
    const area = room.measuredAreaM2 ?? room.drawingAreaM2;
    if (area !== null) quantitative.room_area_m2 = area;
  }

  if (room.occupancyConfirmedAt !== null && room.occupancyCount !== null) {
    quantitative.room_occupancy = room.occupancyCount;
    // Only a genuine physical count feeds the reconciliation as "physical" —
    // an occupancy that was itself promoted from the schedule has nothing
    // independent left to reconcile against.
    if (room.occupancySource === "physical_count") {
      quantitative.room_occupancy_physical = room.occupancyCount;
    }
  }

  if (room.scheduleOccupancyHeadcount !== null) {
    quantitative.room_occupancy_schedule = room.scheduleOccupancyHeadcount;
  }

  return quantitative;
}
