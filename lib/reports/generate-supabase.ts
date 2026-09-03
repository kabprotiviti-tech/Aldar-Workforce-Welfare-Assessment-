import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ReportGenerationDb } from "@/lib/reports/generate";
import type { ReportSnapshot } from "@/lib/reports/snapshot";

function oneOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Real adapter. Reads go through the caller's own session (RLS governs
 * who may generate a report the normal way); the Storage upload goes
 * through the service-role client, the same "portal/generation writes
 * bypass RLS by design" reasoning as lib/rfi/portal-supabase.ts; the
 * approve_assessment_and_generate_report RPC call goes through the
 * caller's own session too, since it checks auth.uid() itself
 * (0030_governance.sql) — a service-role call would have no uid to
 * check, and is_admin() would always read false.
 */
export function supabaseReportGenerationDb(supabase: SupabaseClient): ReportGenerationDb {
  return {
    async loadHeaderAndItems(assessmentId) {
      const { data: assessment, error: assessmentError } = await supabase
        .from("assessments")
        .select(
          "subject_code, module, assessment_type, audit_number, actual_visit_date, revision_number, risk_rating, overall_compliance_pct, adjusted_compliance_pct, entities(name), facilities(name)",
        )
        .eq("id", assessmentId)
        .single();
      if (assessmentError) throw assessmentError;

      const entity = oneOf(assessment.entities as unknown as { name: string } | { name: string }[] | null);
      const facility = oneOf(assessment.facilities as unknown as { name: string } | { name: string }[] | null);

      const { data: itemRows, error: itemsError } = await supabase
        .from("assessment_items")
        .select("compliance_status, remarks, action_required, was_assessed, requirements(sl_no, title)")
        .eq("assessment_id", assessmentId);
      if (itemsError) throw itemsError;

      return {
        header: {
          subjectCode: assessment.subject_code as string,
          module: assessment.module as ReportSnapshot["header"]["module"],
          assessmentType: assessment.assessment_type as ReportSnapshot["header"]["assessmentType"],
          entityName: entity?.name ?? "",
          facilityName: facility?.name ?? null,
          auditNumber: Number(assessment.audit_number),
          actualVisitDate: (assessment.actual_visit_date as string | null) ?? null,
          generatedAt: new Date().toISOString(),
          version: Number(assessment.revision_number),
          riskRating: (assessment.risk_rating as ReportSnapshot["header"]["riskRating"]) ?? null,
          overallCompliancePct: (assessment.overall_compliance_pct as number | null) ?? null,
          adjustedCompliancePct: (assessment.adjusted_compliance_pct as number | null) ?? null,
        },
        items: (itemRows ?? []).map((row) => {
          const requirement = oneOf(row.requirements as unknown as { sl_no: number; title: string } | { sl_no: number; title: string }[] | null);
          return {
            requirementSlNo: requirement?.sl_no ?? 0,
            requirementTitle: requirement?.title ?? "",
            remarks: row.remarks as string | null,
            actionRequired: row.action_required as string | null,
            complianceStatus: row.compliance_status as ReportSnapshot["rows"][number]["complianceAssessment"],
            wasAssessed: row.was_assessed as boolean,
          };
        }),
      };
    },

    async uploadSnapshotFile(assessmentId, version, bytes) {
      const admin = createSupabaseAdminClient();
      const storagePath = `${assessmentId}/v${version}.json`;
      const { error } = await admin.storage.from("reports").upload(storagePath, bytes, { contentType: "application/json", upsert: false });
      if (error) throw error;
      return { storagePath };
    },

    async approveAndInsertReport(assessmentId, storagePath, snapshot) {
      const { data, error } = await supabase.rpc("approve_assessment_and_generate_report", {
        p_assessment_id: assessmentId,
        p_storage_path: storagePath,
        p_snapshot: snapshot,
        p_format: "json",
      });
      if (error) throw error;
      return { reportId: data as string };
    },
  };
}
