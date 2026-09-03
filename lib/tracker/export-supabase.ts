import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ComplianceRating } from "@/lib/rules/constants";
import type { TrackerRequirementRating, TrackerRow } from "@/lib/tracker/rows";

function oneOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Real adapter for the Excel project tracker (this prompt: "written from
 * platform activity, not maintained by hand"). Every date below is a real,
 * stored timestamp; the two genuinely-unavailable RFP fields (RFI issue
 * date / completed desktop assessment date) are approximated from the
 * closest real, stored events rather than fabricated — see
 * docs/decisions.md.
 *
 * Reads go through the caller's own session (RLS: `is_staff()`), the same
 * reasoning as lib/scheduling/portfolio.ts — no Storage access is needed
 * here, so no service-role client either.
 */
export async function loadTrackerRowsForCycle(supabase: SupabaseClient, cycleId: string): Promise<TrackerRow[]> {
  const { data: assessmentRows, error: assessmentsError } = await supabase
    .from("assessments")
    .select(
      "id, subject_code, module, audit_number, assessment_type, entity_id, confirmed_visit_date, actual_visit_date, qa_completed_at, approved_at, issued_at, entities(name), facilities(name)",
    )
    .eq("cycle_id", cycleId)
    .is("deleted_at", null)
    .order("subject_code");
  if (assessmentsError) throw assessmentsError;

  const assessmentIds = (assessmentRows ?? []).map((row) => row.id as string);
  const entityIds = Array.from(new Set((assessmentRows ?? []).map((row) => row.entity_id as string)));

  if (assessmentIds.length === 0) return [];

  const [itemsResult, rfiResult, contactsResult] = await Promise.all([
    supabase
      .from("assessment_items")
      .select("assessment_id, compliance_status, decided_at, requirements(sl_no, title)")
      .in("assessment_id", assessmentIds),
    supabase
      .from("rfi_requests")
      .select("assessment_id, status, issued_at")
      .in("assessment_id", assessmentIds)
      .order("issued_at"),
    supabase.from("entity_contacts").select("entity_id, name, email, phone").in("entity_id", entityIds).eq("is_primary", true).is("deleted_at", null),
  ]);
  if (itemsResult.error) throw itemsResult.error;
  if (rfiResult.error) throw rfiResult.error;
  if (contactsResult.error) throw contactsResult.error;

  // "Completed desktop assessment date" (RFP field, no direct column):
  // approximated as the last piece of evidence actually received through
  // the RFI portal for an assessment whose RFI(s) are all completed — a
  // real, stored timestamp of the real event that triggered completion,
  // not a fabricated date. Only fetched for assessments that have at
  // least one completed RFI, to avoid scanning evidence for every
  // assessment in the cycle.
  const completedRfiAssessmentIds = Array.from(
    new Set((rfiResult.data ?? []).filter((row) => row.status === "completed").map((row) => row.assessment_id as string)),
  );
  const lastPortalUploadByAssessmentId = new Map<string, string>();
  if (completedRfiAssessmentIds.length > 0) {
    const { data: evidenceRows, error: evidenceError } = await supabase
      .from("evidence_files")
      .select("assessment_id, uploaded_at")
      .in("assessment_id", completedRfiAssessmentIds)
      .eq("document_class", "rfi_upload")
      .order("uploaded_at", { ascending: false });
    if (evidenceError) throw evidenceError;
    for (const row of evidenceRows ?? []) {
      const assessmentId = row.assessment_id as string;
      if (!lastPortalUploadByAssessmentId.has(assessmentId)) {
        lastPortalUploadByAssessmentId.set(assessmentId, row.uploaded_at as string);
      }
    }
  }

  const earliestRfiIssuedAtByAssessmentId = new Map<string, string>();
  for (const row of rfiResult.data ?? []) {
    const assessmentId = row.assessment_id as string;
    if (!earliestRfiIssuedAtByAssessmentId.has(assessmentId)) {
      earliestRfiIssuedAtByAssessmentId.set(assessmentId, row.issued_at as string);
    }
  }

  const contactByEntityId = new Map<string, { name: string; email: string | null; phone: string | null }>();
  for (const row of contactsResult.data ?? []) {
    contactByEntityId.set(row.entity_id as string, { name: row.name as string, email: row.email as string | null, phone: row.phone as string | null });
  }

  const requirementsByAssessmentId = new Map<string, TrackerRequirementRating[]>();
  const lastDecidedAtByAssessmentId = new Map<string, string>();
  for (const row of itemsResult.data ?? []) {
    const assessmentId = row.assessment_id as string;
    const requirement = oneOf(row.requirements as unknown as { sl_no: number; title: string } | { sl_no: number; title: string }[] | null);
    const list = requirementsByAssessmentId.get(assessmentId) ?? [];
    list.push({
      requirementSlNo: requirement?.sl_no ?? 0,
      requirementTitle: requirement?.title ?? "",
      rating: (row.compliance_status as ComplianceRating | null) ?? null,
    });
    requirementsByAssessmentId.set(assessmentId, list);

    const decidedAt = row.decided_at as string | null;
    if (decidedAt) {
      const current = lastDecidedAtByAssessmentId.get(assessmentId);
      if (!current || decidedAt > current) lastDecidedAtByAssessmentId.set(assessmentId, decidedAt);
    }
  }

  return (assessmentRows ?? []).map((row) => {
    const id = row.id as string;
    const entityId = row.entity_id as string;
    const entity = oneOf(row.entities as unknown as { name: string } | { name: string }[] | null);
    const facility = oneOf(row.facilities as unknown as { name: string } | { name: string }[] | null);
    const contact = contactByEntityId.get(entityId) ?? null;
    // Desktop assessment date reuses the RFI issue date — the platform
    // captures no separate "desktop review started" event distinct from
    // "the request for information went out." See docs/decisions.md.
    const rfiIssueDate = earliestRfiIssuedAtByAssessmentId.get(id) ?? null;

    return {
      subjectCode: row.subject_code as string,
      module: row.module as TrackerRow["module"],
      entityName: entity?.name ?? "",
      facilityName: facility?.name ?? null,
      auditNumber: Number(row.audit_number),
      assessmentType: row.assessment_type as TrackerRow["assessmentType"],
      rfiIssueDate,
      desktopAssessmentDate: rfiIssueDate,
      completedDesktopAssessmentDate: lastPortalUploadByAssessmentId.get(id) ?? null,
      officeVisitDate: (row.confirmed_visit_date as string | null) ?? null,
      completedVisitDate: (row.actual_visit_date as string | null) ?? null,
      reportCompletionDate: lastDecidedAtByAssessmentId.get(id) ?? null,
      reportQaCompletionDate: (row.qa_completed_at as string | null) ?? null,
      reportApprovalDate: (row.approved_at as string | null) ?? null,
      reportIssuanceDate: (row.issued_at as string | null) ?? null,
      contactName: contact?.name ?? null,
      contactEmail: contact?.email ?? null,
      contactPhone: contact?.phone ?? null,
      requirements: requirementsByAssessmentId.get(id) ?? [],
    };
  });
}
