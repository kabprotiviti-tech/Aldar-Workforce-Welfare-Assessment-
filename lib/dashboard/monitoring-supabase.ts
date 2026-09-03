import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbModule } from "@/lib/db/common";
import type { ComplianceRating } from "@/lib/rules/constants";
import {
  buildActionAgeingBuckets,
  buildAssessmentLineage,
  buildComplianceByRequirementAcrossCycles,
  buildRepeatFindingsByRequirementAndEntity,
  type ActionAgeingGroup,
  type LineageEvent,
  type RepeatFindingsGroup,
  type RequirementTrend,
} from "@/lib/dashboard/monitoring";

function oneOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Monitoring view reads (this prompt: "compliance by requirement across
 * cycles, repeat findings by requirement and entity, action ageing
 * buckets, a full lineage view"). Staff-only via `is_staff()` RLS.
 * Portfolio-wide across cycles, scoped to one module at a time — mixing
 * modules would conflate requirement numbering (EP/Onboarding's sl_no 1
 * is a different requirement from Accommodation's sl_no 1, see
 * docs/schema.md).
 */
export async function loadComplianceByRequirementAcrossCycles(supabase: SupabaseClient, module: DbModule): Promise<RequirementTrend[]> {
  const { data: assessmentRows, error: assessmentsError } = await supabase
    .from("assessments")
    .select("id, cycles(year)")
    .eq("module", module)
    .is("deleted_at", null);
  if (assessmentsError) throw assessmentsError;

  const assessmentIds = (assessmentRows ?? []).map((row) => row.id as string);
  if (assessmentIds.length === 0) return [];

  const yearByAssessmentId = new Map(
    (assessmentRows ?? []).map((row) => [row.id as string, (oneOf(row.cycles as unknown as { year: number } | { year: number }[] | null))?.year ?? 0]),
  );

  const { data: itemRows, error: itemsError } = await supabase
    .from("assessment_items")
    .select("assessment_id, compliance_status, requirements(sl_no, title)")
    .in("assessment_id", assessmentIds);
  if (itemsError) throw itemsError;

  const rows = (itemRows ?? []).map((row) => {
    const requirement = oneOf(row.requirements as unknown as { sl_no: number; title: string } | { sl_no: number; title: string }[] | null);
    return {
      cycleYear: yearByAssessmentId.get(row.assessment_id as string) ?? 0,
      requirementSlNo: requirement?.sl_no ?? 0,
      requirementTitle: requirement?.title ?? "",
      rating: (row.compliance_status as ComplianceRating | null) ?? null,
    };
  });

  return buildComplianceByRequirementAcrossCycles(rows);
}

export async function loadRepeatFindingsByRequirementAndEntity(supabase: SupabaseClient): Promise<RepeatFindingsGroup[]> {
  const { data, error } = await supabase
    .from("findings")
    .select("id, entity_id, entities(name), assessment_items(requirements(sl_no, title))")
    .not("repeat_of_finding_id", "is", null)
    .neq("status", "closed")
    .is("deleted_at", null);
  if (error) throw error;

  const rows = (data ?? []).map((row) => {
    const entity = oneOf(row.entities as unknown as { name: string } | { name: string }[] | null);
    const item = oneOf(row.assessment_items as unknown as { requirements: unknown } | { requirements: unknown }[] | null);
    const requirement = oneOf(item?.requirements as unknown as { sl_no: number; title: string } | { sl_no: number; title: string }[] | null);
    return {
      findingId: row.id as string,
      requirementSlNo: requirement?.sl_no ?? 0,
      requirementTitle: requirement?.title ?? "",
      entityId: row.entity_id as string,
      entityName: entity?.name ?? "",
    };
  });

  return buildRepeatFindingsByRequirementAndEntity(rows);
}

export async function loadActionAgeingBuckets(supabase: SupabaseClient, todayIso: string = new Date().toISOString().slice(0, 10)): Promise<ActionAgeingGroup[]> {
  const { data, error } = await supabase
    .from("findings")
    .select("id, title, created_at, assessment_items(assessments(subject_code))")
    .neq("status", "closed")
    .is("deleted_at", null);
  if (error) throw error;

  const rows = (data ?? []).map((row) => {
    const item = oneOf(row.assessment_items as unknown as { assessments: unknown } | { assessments: unknown }[] | null);
    const assessment = oneOf(item?.assessments as unknown as { subject_code: string } | { subject_code: string }[] | null);
    return {
      findingId: row.id as string,
      title: row.title as string,
      subjectCode: assessment?.subject_code ?? "",
      createdAt: row.created_at as string,
    };
  });

  return buildActionAgeingBuckets(rows, todayIso);
}

export async function loadAssessmentLineage(supabase: SupabaseClient, assessmentId: string): Promise<LineageEvent[]> {
  const [{ data: assessment, error: assessmentError }, { data: itemRows, error: itemsError }, { data: rfiRows, error: rfiError }, { data: reportRows, error: reportsError }] =
    await Promise.all([
      supabase.from("assessments").select("issued_at").eq("id", assessmentId).maybeSingle(),
      supabase.from("assessment_items").select("id, compliance_status, decided_at, requirements(sl_no, title)").eq("assessment_id", assessmentId),
      supabase.from("rfi_requests").select("id, status, issued_at").eq("assessment_id", assessmentId).is("deleted_at", null),
      supabase.from("reports").select("version, generated_at").eq("assessment_id", assessmentId),
    ]);
  if (assessmentError) throw assessmentError;
  if (itemsError) throw itemsError;
  if (rfiError) throw rfiError;
  if (reportsError) throw reportsError;

  const itemIds = (itemRows ?? []).map((row) => row.id as string);
  const evidenceResult = await supabase.from("evidence_files").select("original_name, uploaded_at, document_class").eq("assessment_id", assessmentId);
  if (evidenceResult.error) throw evidenceResult.error;

  const completedRfiIds = (rfiRows ?? []).filter((row) => row.status === "completed").map((row) => row.id as string);
  const lastPortalUploadAt = completedRfiIds.length > 0
    ? (evidenceResult.data ?? [])
        .filter((row) => row.document_class === "rfi_upload")
        .map((row) => row.uploaded_at as string)
        .sort()
        .at(-1) ?? null
    : null;

  const findingsResult =
    itemIds.length > 0
      ? await supabase.from("findings").select("id, title, created_at, closed_at").in("assessment_item_id", itemIds).is("deleted_at", null)
      : { data: [], error: null };
  if (findingsResult.error) throw findingsResult.error;

  const events: LineageEvent[] = [];

  for (const row of rfiRows ?? []) {
    events.push({ kind: "rfi_issued", at: row.issued_at as string, label: "RFI issued", detail: null });
  }
  // "RFI completed" has no direct stored timestamp — the last portal
  // upload against a completed RFI is used as the real, stored proxy,
  // the same reasoning as lib/tracker/export-supabase.ts's
  // completedDesktopAssessmentDate. See docs/decisions.md.
  if (lastPortalUploadAt) {
    events.push({ kind: "rfi_completed", at: lastPortalUploadAt, label: "RFI completed", detail: null });
  }

  for (const row of evidenceResult.data ?? []) {
    events.push({ kind: "evidence_uploaded", at: row.uploaded_at as string, label: "Evidence uploaded", detail: row.original_name as string });
  }

  for (const row of itemRows ?? []) {
    if (!row.decided_at) continue;
    const requirement = oneOf(row.requirements as unknown as { sl_no: number; title: string } | { sl_no: number; title: string }[] | null);
    events.push({
      kind: "item_decided",
      at: row.decided_at as string,
      label: "Requirement decided",
      detail: requirement ? `${requirement.sl_no}. ${requirement.title} — ${row.compliance_status}` : (row.compliance_status as string | null),
    });
  }

  for (const row of findingsResult.data ?? []) {
    events.push({ kind: "finding_raised", at: row.created_at as string, label: "Finding raised", detail: row.title as string });
    if (row.closed_at) {
      events.push({ kind: "finding_closed", at: row.closed_at as string, label: "Finding closed", detail: row.title as string });
    }
  }

  for (const row of reportRows ?? []) {
    events.push({ kind: "report_generated", at: row.generated_at as string, label: `Report v${row.version} generated`, detail: null });
  }

  if (assessment?.issued_at) {
    events.push({ kind: "report_issued", at: assessment.issued_at as string, label: "Report issued to client", detail: null });
  }

  return buildAssessmentLineage(events);
}
