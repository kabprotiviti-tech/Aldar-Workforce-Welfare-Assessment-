import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { groupByLifecycleStage, type LifecycleSignals, type StageCount } from "@/lib/dashboard/lifecycle";
import { loadSignalsForAssessments } from "@/lib/dashboard/signals-supabase";
import type { Signal } from "@/lib/dashboard/signals";

export interface ExecutiveOverview {
  cycleId: string;
  cycleName: string;
  stageCounts: StageCount[];
  signals: Signal[];
  /** Display label only — the stage counts above already carry the real ids to drill into. */
  subjectCodeByAssessmentId: Record<string, string>;
}

/**
 * Executive overview reads (this prompt: "cycle progress, 8-stage
 * lifecycle rail with live counts, attention list"). Staff-only via
 * `is_staff()` RLS, the same reasoning as every other portfolio-wide
 * read in this app (lib/scheduling/portfolio.ts). Every count here
 * traces back to the exact rows fetched below — nothing is aggregated
 * in SQL that this function doesn't also keep the underlying ids for.
 */
export async function loadExecutiveOverview(supabase: SupabaseClient, cycleId: string, todayIso: string = new Date().toISOString().slice(0, 10)): Promise<ExecutiveOverview> {
  const { data: cycle, error: cycleError } = await supabase.from("cycles").select("name").eq("id", cycleId).maybeSingle();
  if (cycleError) throw cycleError;

  const { data: assessmentRows, error: assessmentsError } = await supabase
    .from("assessments")
    .select("id, subject_code, confirmed_visit_date, actual_visit_date, issued_at, report_due_date")
    .eq("cycle_id", cycleId)
    .is("deleted_at", null);
  if (assessmentsError) throw assessmentsError;

  const assessmentIds = (assessmentRows ?? []).map((row) => row.id as string);
  const subjectCodeByAssessmentId = new Map((assessmentRows ?? []).map((row) => [row.id as string, row.subject_code as string]));

  if (assessmentIds.length === 0) {
    return { cycleId, cycleName: (cycle?.name as string | undefined) ?? "", stageCounts: groupByLifecycleStage([]), signals: [], subjectCodeByAssessmentId: {} };
  }

  const rfiResult = await supabase.from("rfi_requests").select("assessment_id, status").in("assessment_id", assessmentIds);
  if (rfiResult.error) throw rfiResult.error;

  // Fetched again here (rather than reused from loadSignalsForAssessments
  // below) because the lifecycle rail needs per-assessment item/finding
  // *counts*, not the signal builders' already-filtered rows — a
  // deliberate second, cheap, indexed query rather than plumbing two
  // different shapes out of one fetch.
  const itemsResult = await supabase.from("assessment_items").select("id, assessment_id, compliance_status").in("assessment_id", assessmentIds);
  if (itemsResult.error) throw itemsResult.error;

  const itemIds = (itemsResult.data ?? []).map((row) => row.id as string);
  const findingsResult =
    itemIds.length > 0
      ? await supabase.from("findings").select("status, assessment_item_id").in("assessment_item_id", itemIds).is("deleted_at", null)
      : { data: [], error: null };
  if (findingsResult.error) throw findingsResult.error;

  // --- Lifecycle rail ---
  const hasIssuedRfiByAssessmentId = new Map<string, boolean>();
  const hasOpenRfiByAssessmentId = new Map<string, boolean>();
  for (const row of rfiResult.data ?? []) {
    const assessmentId = row.assessment_id as string;
    hasIssuedRfiByAssessmentId.set(assessmentId, true);
    if (row.status === "open") hasOpenRfiByAssessmentId.set(assessmentId, true);
  }

  const assessmentIdByItemId = new Map((itemsResult.data ?? []).map((row) => [row.id as string, row.assessment_id as string]));
  const totalItemsByAssessmentId = new Map<string, number>();
  const decidedItemsByAssessmentId = new Map<string, number>();
  for (const row of itemsResult.data ?? []) {
    const assessmentId = row.assessment_id as string;
    totalItemsByAssessmentId.set(assessmentId, (totalItemsByAssessmentId.get(assessmentId) ?? 0) + 1);
    if (row.compliance_status) decidedItemsByAssessmentId.set(assessmentId, (decidedItemsByAssessmentId.get(assessmentId) ?? 0) + 1);
  }

  const openFindingsByAssessmentId = new Map<string, number>();
  for (const row of findingsResult.data ?? []) {
    if (row.status === "closed") continue;
    const assessmentId = assessmentIdByItemId.get(row.assessment_item_id as string);
    if (!assessmentId) continue;
    openFindingsByAssessmentId.set(assessmentId, (openFindingsByAssessmentId.get(assessmentId) ?? 0) + 1);
  }

  const lifecycleSignals: LifecycleSignals[] = (assessmentRows ?? []).map((row) => {
    const id = row.id as string;
    return {
      assessmentId: id,
      hasIssuedRfi: hasIssuedRfiByAssessmentId.get(id) ?? false,
      hasOpenRfi: hasOpenRfiByAssessmentId.get(id) ?? false,
      confirmedVisitDate: (row.confirmed_visit_date as string | null) ?? null,
      actualVisitDate: (row.actual_visit_date as string | null) ?? null,
      totalItems: totalItemsByAssessmentId.get(id) ?? 0,
      decidedItems: decidedItemsByAssessmentId.get(id) ?? 0,
      issuedAt: (row.issued_at as string | null) ?? null,
      openFindingsCount: openFindingsByAssessmentId.get(id) ?? 0,
    };
  });
  const stageCounts = groupByLifecycleStage(lifecycleSignals);

  // --- Attention list signals ---
  const signals = await loadSignalsForAssessments(
    supabase,
    (assessmentRows ?? []).map((row) => ({
      id: row.id as string,
      subjectCode: row.subject_code as string,
      issuedAt: (row.issued_at as string | null) ?? null,
      reportDueDate: (row.report_due_date as string | null) ?? null,
    })),
    todayIso,
  );

  return {
    cycleId,
    cycleName: (cycle?.name as string | undefined) ?? "",
    stageCounts,
    signals,
    subjectCodeByAssessmentId: Object.fromEntries(subjectCodeByAssessmentId),
  };
}
