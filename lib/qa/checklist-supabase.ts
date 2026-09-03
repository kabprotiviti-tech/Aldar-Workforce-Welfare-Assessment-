import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runQaChecklist, type QaCheckResult, type QaChecklistItemInput } from "@/lib/qa/checklist";
import { countProposedFactsForAssessment } from "@/lib/facts/ledger-supabase";
import type { DbModule } from "@/lib/db/common";

/**
 * Gathers everything lib/qa/checklist.ts's eight pure rules need, for
 * one assessment, and runs them. The only place that knows how each
 * rule's input is actually stored — assessment_items, ai_observations,
 * photos. The proposed-fact count comes from
 * lib/facts/ledger-supabase.ts rather than a direct query here: that
 * module (along with the extraction writer) is the only one allowed to
 * touch extracted_facts at all (tests/read-path.test.ts).
 */
export async function loadAndRunQaChecklist(supabase: SupabaseClient, assessmentId: string): Promise<QaCheckResult[]> {
  const { data: assessment, error: assessmentError } = await supabase.from("assessments").select("module").eq("id", assessmentId).single();
  if (assessmentError) throw assessmentError;
  const assessmentModule = assessment.module as DbModule;

  const { data: itemRows, error: itemsError } = await supabase
    .from("assessment_items")
    .select("id, requirement_id, compliance_status, remarks, action_required, was_assessed, quantitative, evidence_detail, requirements(sl_no, title)")
    .eq("assessment_id", assessmentId);
  if (itemsError) throw itemsError;

  const requirementIds = (itemRows ?? []).map((row) => row.requirement_id as string);

  const [{ data: photoRows, error: photosError }, { count: openObservationCount, error: observationsError }, proposedFactCount] = await Promise.all([
    requirementIds.length > 0
      ? supabase.from("photos").select("requirement_id").eq("assessment_id", assessmentId).in("requirement_id", requirementIds)
      : Promise.resolve({ data: [] as { requirement_id: string | null }[], error: null }),
    supabase
      .from("ai_observations")
      .select("id, assessment_items!inner(assessment_id)", { count: "exact", head: true })
      .eq("assessment_items.assessment_id", assessmentId)
      .eq("status", "open"),
    countProposedFactsForAssessment(supabase, assessmentId),
  ]);
  if (photosError) throw photosError;
  if (observationsError) throw observationsError;

  const requirementIdsWithPhotos = new Set((photoRows ?? []).map((row) => row.requirement_id));

  const items: QaChecklistItemInput[] = (itemRows ?? []).map((row) => {
    const requirement = (Array.isArray(row.requirements) ? row.requirements[0] : row.requirements) as { sl_no: number; title: string } | null;
    return {
      itemId: row.id as string,
      requirementSlNo: requirement?.sl_no ?? 0,
      requirementTitle: requirement?.title ?? "",
      status: row.compliance_status as QaChecklistItemInput["status"],
      remarks: row.remarks as string | null,
      actionRequired: row.action_required as string | null,
      wasAssessed: row.was_assessed as boolean,
      quantitative: row.quantitative,
      hasPhoto: requirementIdsWithPhotos.has(row.requirement_id as string),
      evidenceDetail: row.evidence_detail,
    };
  });

  return runQaChecklist({
    module: assessmentModule,
    items,
    openObservationCount: openObservationCount ?? 0,
    proposedFactCount,
  });
}
