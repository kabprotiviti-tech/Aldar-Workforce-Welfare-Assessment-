import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FactConfidence } from "@/lib/db/evidence";
import type { GroupedFact } from "@/lib/rooms/group-facts";
import { proposeRoomMeasurements } from "@/lib/rooms/propose";

/**
 * Real adapter for lib/rooms/propose.ts: reads fact_ledger_confirmed —
 * the same view the rule engine reads, so a room proposal can only ever
 * be built from a value a person has already accepted or edited — and
 * writes the result through propose_room_measurements
 * (0027_room_area.sql), which is the only thing allowed to touch
 * rooms.drawing_area_m2/schedule_occupancy_headcount.
 */

async function loadConfirmedFactsWithGroups(supabase: SupabaseClient, assessmentId: string): Promise<GroupedFact[]> {
  const { data, error } = await supabase
    .from("fact_ledger_confirmed")
    .select("fact_key, group_ref, confirmed_value, confidence")
    .eq("assessment_id", assessmentId);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    factKey: row.fact_key as string,
    groupRef: row.group_ref as string | null,
    confirmedValue: row.confirmed_value as GroupedFact["confirmedValue"],
    confidence: row.confidence as FactConfidence | null,
  }));
}

export interface ProposeRoomMeasurementsResult {
  proposalCount: number;
}

/**
 * Computes and writes room proposals from one assessment's confirmed
 * facts. `drawingSourceFileId` is recorded against a room only when this
 * run actually proposes an area for it — the assessor picks the drawing
 * evidence file they just extracted, so the report can point back to it.
 */
export async function proposeRoomMeasurementsForAssessment(
  supabase: SupabaseClient,
  input: { assessmentId: string; facilityId: string; drawingSourceFileId: string | null },
): Promise<ProposeRoomMeasurementsResult> {
  const facts = await loadConfirmedFactsWithGroups(supabase, input.assessmentId);
  const proposals = proposeRoomMeasurements(facts);

  if (proposals.length === 0) return { proposalCount: 0 };

  const { error } = await supabase.rpc("propose_room_measurements", {
    p_facility_id: input.facilityId,
    p_drawing_source_file_id: input.drawingSourceFileId,
    p_proposals: proposals.map((proposal) => ({
      room_ref: proposal.roomRef,
      drawing_area_m2: proposal.drawingAreaM2,
      low_confidence: proposal.lowConfidence,
      schedule_occupancy_headcount: proposal.scheduleOccupancyHeadcount,
    })),
  });
  if (error) throw error;

  return { proposalCount: proposals.length };
}
