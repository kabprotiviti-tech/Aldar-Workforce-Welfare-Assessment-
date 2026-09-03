import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAtRiskDeadlinesSignal,
  buildEvidenceAwaitingReviewSignal,
  buildExpiringCertificatesSignal,
  buildOverdueActionsSignal,
  buildRepeatFindingsSignal,
  type Signal,
} from "@/lib/dashboard/signals";
import type { Certificate } from "@/lib/db/accommodation-quantitative";

export interface SignalScopeAssessment {
  id: string;
  subjectCode: string;
  issuedAt: string | null;
  reportDueDate: string | null;
}

/**
 * The five attention-list signals (this prompt), for any already-chosen
 * set of assessments — shared by the executive overview (scoped to one
 * cycle) and the daily digest (scoped to one assessor's own portfolio
 * across every cycle). Callers resolve which assessments are in scope;
 * this function only reads what those assessments actually contain.
 */
export async function loadSignalsForAssessments(supabase: SupabaseClient, assessments: readonly SignalScopeAssessment[], todayIso: string): Promise<Signal[]> {
  const assessmentIds = assessments.map((a) => a.id);
  const subjectCodeByAssessmentId = new Map(assessments.map((a) => [a.id, a.subjectCode]));
  if (assessmentIds.length === 0) return [];

  const itemsResult = await supabase.from("assessment_items").select("id, assessment_id, quantitative").in("assessment_id", assessmentIds);
  if (itemsResult.error) throw itemsResult.error;

  const itemIds = (itemsResult.data ?? []).map((row) => row.id as string);
  const assessmentIdByItemId = new Map((itemsResult.data ?? []).map((row) => [row.id as string, row.assessment_id as string]));

  const findingsResult =
    itemIds.length > 0
      ? await supabase
          .from("findings")
          .select("id, status, due_date, title, repeat_of_finding_id, assessment_item_id")
          .in("assessment_item_id", itemIds)
          .is("deleted_at", null)
      : { data: [], error: null };
  if (findingsResult.error) throw findingsResult.error;

  const evidenceResult = await supabase
    .from("evidence_files")
    .select("id, original_name, assessment_id")
    .in("assessment_id", assessmentIds)
    .in("review_status", ["received", "in_review"]);
  if (evidenceResult.error) throw evidenceResult.error;

  const evidenceSignal = buildEvidenceAwaitingReviewSignal(
    (evidenceResult.data ?? []).map((row) => ({
      id: row.id as string,
      originalName: row.original_name as string,
      assessmentId: row.assessment_id as string,
      subjectCode: subjectCodeByAssessmentId.get(row.assessment_id as string) ?? "",
    })),
  );

  const overdueRows = (findingsResult.data ?? [])
    .filter((row) => row.status !== "closed" && row.due_date)
    .map((row) => {
      const assessmentId = assessmentIdByItemId.get(row.assessment_item_id as string) ?? "";
      return { id: row.id as string, title: row.title as string, dueDate: row.due_date as string, subjectCode: subjectCodeByAssessmentId.get(assessmentId) ?? "" };
    });
  const overdueSignal = buildOverdueActionsSignal(overdueRows, todayIso);

  const repeatRows = (findingsResult.data ?? [])
    .filter((row) => row.status !== "closed" && row.repeat_of_finding_id)
    .map((row) => {
      const assessmentId = assessmentIdByItemId.get(row.assessment_item_id as string) ?? "";
      return {
        id: row.id as string,
        title: row.title as string,
        subjectCode: subjectCodeByAssessmentId.get(assessmentId) ?? "",
        repeatOfFindingId: row.repeat_of_finding_id as string,
      };
    });
  const repeatSignal = buildRepeatFindingsSignal(repeatRows);

  const atRiskRows = assessments
    .filter((a) => !a.issuedAt && a.reportDueDate)
    .map((a) => ({ assessmentId: a.id, subjectCode: a.subjectCode, reportDueDate: a.reportDueDate as string }));
  const atRiskSignal = buildAtRiskDeadlinesSignal(atRiskRows, todayIso);

  const certificateRows: { assessmentItemId: string; assessmentId: string; subjectCode: string; certificateType: string; validTo: string }[] = [];
  for (const row of itemsResult.data ?? []) {
    const quantitative = row.quantitative as { certificates?: Certificate[] } | null;
    const assessmentId = row.assessment_id as string;
    for (const certificate of quantitative?.certificates ?? []) {
      if (!certificate.valid_to) continue;
      certificateRows.push({
        assessmentItemId: row.id as string,
        assessmentId,
        subjectCode: subjectCodeByAssessmentId.get(assessmentId) ?? "",
        certificateType: certificate.type,
        validTo: certificate.valid_to,
      });
    }
  }
  const certificateSignal = buildExpiringCertificatesSignal(certificateRows, todayIso);

  return [evidenceSignal, overdueSignal, atRiskSignal, repeatSignal, certificateSignal];
}
