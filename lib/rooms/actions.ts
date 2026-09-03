"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { proposeRoomMeasurementsForAssessment } from "@/lib/rooms/propose-supabase";
import { buildRoomSubjects } from "@/lib/rooms/subjects-supabase";
import { supabaseEvaluationDb } from "@/lib/rules/compliance/evaluate-supabase";
import { runAndStore } from "@/lib/rules/compliance/evaluate";

/**
 * The assessor's actions on room measurements — propose from a
 * drawing's confirmed facts, confirm or override the proposed area,
 * promote a schedule occupancy figure, and run the rules that read them
 * (this prompt). Authorization is the database's throughout:
 * resolve_room_area/confirm_room_occupancy_from_schedule/
 * propose_room_measurements each check is_staff()/can_write_operational()
 * themselves and run through the caller's own session-scoped client, so
 * auth.uid() recorded as the actor is the real assessor.
 */

export type RoomActionResult = { ok: true } | { ok: false; message: string };

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/only staff may confirm|only staff may propose|only an admin or assessor/i.test(message)) {
    return "You don't have permission to change room measurements.";
  }
  return message;
}

export async function proposeRoomMeasurements(assessmentId: string, evidenceFileId: string | null): Promise<RoomActionResult> {
  const supabase = await createSupabaseServerClient();

  const { data: assessment, error } = await supabase.from("assessments").select("id, facility_id").eq("id", assessmentId).maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!assessment?.facility_id) return { ok: false, message: "This assessment has no facility to propose room measurements against." };

  try {
    await proposeRoomMeasurementsForAssessment(supabase, {
      assessmentId,
      facilityId: assessment.facility_id as string,
      drawingSourceFileId: evidenceFileId,
    });
  } catch (err) {
    return { ok: false, message: friendlyError(err) };
  }

  revalidatePath(`/app/facilities/${assessment.facility_id}/rooms`);
  return { ok: true };
}

export async function confirmRoomArea(roomId: string, facilityId: string): Promise<RoomActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("resolve_room_area", { p_room_id: roomId, p_action: "confirm", p_measured_area_m2: null });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath(`/app/facilities/${facilityId}/rooms`);
  return { ok: true };
}

export async function overrideRoomArea(roomId: string, facilityId: string, measuredAreaM2: number): Promise<RoomActionResult> {
  if (!Number.isFinite(measuredAreaM2) || measuredAreaM2 <= 0) {
    return { ok: false, message: "Enter the measured area as a positive number of square metres." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("resolve_room_area", { p_room_id: roomId, p_action: "override", p_measured_area_m2: measuredAreaM2 });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath(`/app/facilities/${facilityId}/rooms`);
  return { ok: true };
}

export async function confirmScheduleOccupancy(roomId: string, facilityId: string): Promise<RoomActionResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("confirm_room_occupancy_from_schedule", { p_room_id: roomId });
  if (error) return { ok: false, message: friendlyError(error) };
  revalidatePath(`/app/facilities/${facilityId}/rooms`);
  return { ok: true };
}

const ROOM_RULE_CODES = ["R18_ROOM_AREA", "R18_ROOM_HEADCOUNT", "ACM_OCCUPANCY_RECONCILED"] as const;

export type EvaluateRoomRulesResult =
  | { ok: true; storedCount: number; problems: { ruleCode: string; problem: string }[] }
  | { ok: false; message: string };

/**
 * Runs the room-level rules for every room at a facility, against the
 * facility's most recent employment-practices assessment (whose
 * requirement 18 — "Decent accommodation and food" — is what these
 * rules evaluate; ACM_TOILET_RATIO's own module grouping is different,
 * see lib/rules/compliance/registry.ts's doc comment). No assessment
 * found is reported rather than silently doing nothing.
 */
export async function evaluateRoomRules(facilityId: string): Promise<EvaluateRoomRulesResult> {
  const supabase = await createSupabaseServerClient();

  // Ordering by a joined table's own column isn't something to lean on
  // across PostgREST/supabase-js versions, so the (small, one-per-cycle)
  // candidate set is fetched as-is and the most recent picked in code.
  const { data: items, error } = await supabase
    .from("assessment_items")
    .select("id, assessments!inner(actual_visit_date, facility_id, module), requirements!inner(sl_no)")
    .eq("assessments.facility_id", facilityId)
    .eq("assessments.module", "employment_practices")
    .eq("requirements.sl_no", 18);
  if (error) return { ok: false, message: error.message };

  const candidates = (items ?? [])
    .map((row) => {
      const assessment = Array.isArray(row.assessments) ? row.assessments[0] : row.assessments;
      return { assessmentItemId: row.id as string, actualVisitDate: (assessment as { actual_visit_date: string | null } | null)?.actual_visit_date ?? null };
    })
    .filter((candidate): candidate is { assessmentItemId: string; actualVisitDate: string } => candidate.actualVisitDate !== null)
    .sort((a, b) => b.actualVisitDate.localeCompare(a.actualVisitDate));

  const item = candidates[0];
  if (!item) return { ok: false, message: "No employment-practices assessment with a recorded visit date covers requirement 18 for this facility yet." };
  const assessmentDate = item.actualVisitDate;

  try {
    const subjects = await buildRoomSubjects(supabase, { facilityId, assessmentItemId: item.assessmentItemId, assessmentDate });
    if (subjects.length === 0) return { ok: true, storedCount: 0, problems: [] };

    const result = await runAndStore(supabaseEvaluationDb(supabase), [...ROOM_RULE_CODES], subjects);
    revalidatePath(`/app/facilities/${facilityId}/rooms`);
    return { ok: true, storedCount: result.storedCount, problems: result.problems };
  } catch (err) {
    return { ok: false, message: friendlyError(err) };
  }
}
