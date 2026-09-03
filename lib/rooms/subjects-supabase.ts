import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvaluationSubject } from "@/lib/rules/compliance/evaluate";
import { roomQuantitative, type RoomRow } from "@/lib/rooms/subjects";

/**
 * Real adapter for lib/rooms/subjects.ts: reads public.rooms — a
 * facility, not an assessment — because a room's measurements persist
 * across cycles the same way the facility itself does. Session-scoped
 * client throughout; rooms already grants select to `authenticated`
 * under a staff-only policy (0006_rules_measurement.sql).
 */

const ROOM_COLUMNS =
  "room_ref, area_confirmed_at, measured_area_m2, drawing_area_m2, occupancy_confirmed_at, occupancy_count, occupancy_source, schedule_occupancy_headcount";

function toRoomRow(row: Record<string, unknown>): RoomRow {
  return {
    roomRef: row.room_ref as string,
    areaConfirmedAt: (row.area_confirmed_at as string | null) ?? null,
    measuredAreaM2: row.measured_area_m2 === null ? null : Number(row.measured_area_m2),
    drawingAreaM2: row.drawing_area_m2 === null ? null : Number(row.drawing_area_m2),
    occupancyConfirmedAt: (row.occupancy_confirmed_at as string | null) ?? null,
    occupancyCount: row.occupancy_count === null ? null : Number(row.occupancy_count),
    occupancySource: (row.occupancy_source as RoomRow["occupancySource"]) ?? null,
    scheduleOccupancyHeadcount: row.schedule_occupancy_headcount === null ? null : Number(row.schedule_occupancy_headcount),
  };
}

/** Every undeleted room for one facility, as an EvaluationSubject per room, ready for evaluateSubjects/runAndStore. */
export async function buildRoomSubjects(
  supabase: SupabaseClient,
  input: { facilityId: string; assessmentItemId: string; assessmentDate: string },
): Promise<EvaluationSubject[]> {
  const { data, error } = await supabase.from("rooms").select(ROOM_COLUMNS).eq("facility_id", input.facilityId).is("deleted_at", null);
  if (error) throw error;

  return (data ?? []).map((row) => {
    const room = toRoomRow(row as Record<string, unknown>);
    return {
      assessmentItemId: input.assessmentItemId,
      subjectRef: room.roomRef,
      inputs: { facts: {}, quantitative: roomQuantitative(room), assessmentDate: input.assessmentDate },
    };
  });
}
