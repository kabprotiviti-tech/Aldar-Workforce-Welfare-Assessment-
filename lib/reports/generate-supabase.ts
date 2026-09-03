import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ReportGenerationDb } from "@/lib/reports/generate";
import type { AccommodationKeyQuestion, ReportSnapshot } from "@/lib/reports/snapshot";
import { DEFAULT_SCORING_WEIGHTS } from "@/lib/rules/aggregate";

function oneOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** The one place a real client logo would be uploaded, if the org has supplied one — see docs/decisions.md: nothing fabricates a logo when none exists. */
const LOGO_STORAGE_PATH = "logo.png";

/**
 * Real adapter. Reads go through the caller's own session (RLS governs
 * who may generate a report the normal way); Storage reads/writes go
 * through the service-role client, the same "portal/generation writes
 * bypass RLS by design" reasoning as lib/rfi/portal-supabase.ts; the
 * approve_assessment_and_generate_report RPC call goes through the
 * caller's own session too, since it checks auth.uid() itself
 * (0030_governance.sql) — a service-role call would have no uid to
 * check, and is_admin() would always read false.
 */
export function supabaseReportGenerationDb(supabase: SupabaseClient): ReportGenerationDb {
  const admin = createSupabaseAdminClient();

  return {
    async loadReportData(assessmentId) {
      const { data: assessment, error: assessmentError } = await supabase
        .from("assessments")
        .select("subject_code, module, assessment_type, audit_number, actual_visit_date, revision_number, created_by, cycles(name), entities(name), facilities(name)")
        .eq("id", assessmentId)
        .single();
      if (assessmentError) throw assessmentError;

      const cycle = oneOf(assessment.cycles as unknown as { name: string } | { name: string }[] | null);
      const entity = oneOf(assessment.entities as unknown as { name: string } | { name: string }[] | null);
      const facility = oneOf(assessment.facilities as unknown as { name: string } | { name: string }[] | null);

      // assessments.created_by references auth.users, which public.users
      // also does (by id) but with no direct FK between the two tables
      // for PostgREST to embed — the same gap lib/scheduling/portfolio.ts
      // documents for owner_id. A second query resolves the name.
      let originatorName: string | null = null;
      if (assessment.created_by) {
        const { data: originator } = await supabase.from("users").select("full_name").eq("id", assessment.created_by as string).maybeSingle();
        originatorName = (originator?.full_name as string | undefined) ?? null;
      }

      const { data: itemRows, error: itemsError } = await supabase
        .from("assessment_items")
        .select("id, compliance_status, remarks, action_required, was_assessed, requirement_id, requirements(sl_no, title)")
        .eq("assessment_id", assessmentId);
      if (itemsError) throw itemsError;

      const isAccommodation = assessment.module === "accommodation";
      const itemIds = (itemRows ?? []).map((row) => row.id as string);

      const { data: answerRows, error: answersError } = isAccommodation && itemIds.length > 0
        ? await supabase
            .from("assessment_answers")
            .select("assessment_item_id, answer, remark, questions(text)")
            .in("assessment_item_id", itemIds)
        : { data: [] as { assessment_item_id: string; answer: string | null; remark: string | null; questions: unknown }[], error: null };
      if (answersError) throw answersError;

      const keyQuestionsByItemId = new Map<string, AccommodationKeyQuestion[]>();
      for (const row of answerRows ?? []) {
        const question = oneOf(row.questions as unknown as { text: string } | { text: string }[] | null);
        const list = keyQuestionsByItemId.get(row.assessment_item_id) ?? [];
        list.push({
          questionText: question?.text ?? "",
          answer: row.answer as AccommodationKeyQuestion["answer"],
          remark: row.remark as string | null,
        });
        keyQuestionsByItemId.set(row.assessment_item_id, list);
      }

      const { data: photoRows, error: photosError } = await supabase
        .from("photos")
        .select("id, storage_path, caption, requirement_id, requirements(sl_no, title)")
        .eq("assessment_id", assessmentId)
        .order("created_at");
      if (photosError) throw photosError;

      const items = (itemRows ?? []).map((row) => {
        const requirement = oneOf(row.requirements as unknown as { sl_no: number; title: string } | { sl_no: number; title: string }[] | null);
        return {
          requirementSlNo: requirement?.sl_no ?? 0,
          requirementTitle: requirement?.title ?? "",
          remarks: row.remarks as string | null,
          actionRequired: row.action_required as string | null,
          complianceStatus: row.compliance_status as ReportSnapshot["rows"][number]["complianceAssessment"],
          wasAssessed: row.was_assessed as boolean,
        };
      });

      const accommodationItems = isAccommodation
        ? items.map((item, index) => ({
            areaSlNo: item.requirementSlNo,
            areaTitle: item.requirementTitle,
            areaRating: item.complianceStatus,
            areaRemarks: item.remarks,
            areaActionRequired: item.actionRequired,
            wasAssessed: item.wasAssessed,
            keyQuestions: keyQuestionsByItemId.get((itemRows ?? [])[index]!.id as string) ?? [],
          }))
        : [];

      const photos = (photoRows ?? []).map((row) => {
        const requirement = oneOf(row.requirements as unknown as { sl_no: number; title: string } | { sl_no: number; title: string }[] | null);
        return {
          id: row.id as string,
          areaSlNo: requirement?.sl_no ?? null,
          areaTitle: requirement?.title ?? null,
          caption: row.caption as string | null,
          storagePath: row.storage_path as string,
        };
      });

      return {
        subjectCode: assessment.subject_code as string,
        originatorName,
        assessmentType: assessment.assessment_type as ReportSnapshot["header"]["assessmentType"],
        module: assessment.module as ReportSnapshot["header"]["module"],
        projectName: cycle?.name ?? null,
        entityName: entity?.name ?? "",
        facilityName: facility?.name ?? null,
        auditNumber: Number(assessment.audit_number),
        actualVisitDate: (assessment.actual_visit_date as string | null) ?? null,
        revisionNumber: Number(assessment.revision_number),
        items: isAccommodation ? [] : items,
        accommodationItems,
        photos,
        async photoBytes(storagePath: string) {
          const { data, error } = await admin.storage.from("evidence").download(storagePath);
          if (error || !data) return null;
          return new Uint8Array(await data.arrayBuffer());
        },
        logoBytes: await (async () => {
          const { data, error } = await admin.storage.from("reports").download(LOGO_STORAGE_PATH);
          if (error || !data) return null;
          return new Uint8Array(await data.arrayBuffer());
        })(),
      };
    },

    async loadActiveScoringWeights() {
      const { data, error } = await supabase
        .from("scoring_weights")
        .select("id, version, compliant_weight, partial_weight, not_compliant_weight")
        .eq("active", true)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        // Should never happen — 0032_scoring_weights.sql always seeds an active version 1 — but never fabricate weights if it somehow did.
        return { id: "", version: 0, weights: DEFAULT_SCORING_WEIGHTS };
      }
      return {
        id: data.id as string,
        version: data.version as number,
        weights: {
          compliant: Number(data.compliant_weight),
          partial: Number(data.partial_weight),
          notCompliant: Number(data.not_compliant_weight),
        },
      };
    },

    async uploadReportFile(assessmentId, version, bytes) {
      const storagePath = `${assessmentId}/v${version}.pdf`;
      const { error } = await admin.storage.from("reports").upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
      if (error) throw error;
      return { storagePath };
    },

    async approveAndInsertReport(input) {
      const { data, error } = await supabase.rpc("approve_assessment_and_generate_report", {
        p_assessment_id: input.assessmentId,
        p_storage_path: input.storagePath,
        p_snapshot: input.snapshot,
        p_format: "pdf",
        p_scoring_weights_id: input.scoringWeightsId,
        p_risk_rating: input.riskRating,
        p_overall_compliance_pct: input.overallCompliancePct,
        p_adjusted_compliance_pct: input.adjustedCompliancePct,
      });
      if (error) throw error;
      return { reportId: data as string };
    },
  };
}
