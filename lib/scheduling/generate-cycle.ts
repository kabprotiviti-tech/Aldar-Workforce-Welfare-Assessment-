import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbModule } from "@/lib/db/common";
import { buildSubjectCode, nextAuditNumber } from "@/lib/scheduling/subject-code";

/**
 * One entity (Employment Practices/Onboarding) or one facility
 * (Accommodation) eligible for a new assessment this cycle.
 */
export interface GenerateCycleTarget {
  entityId: string;
  facilityId: string | null;
  /** entity_code, or facility_code for Accommodation — see docs/decisions.md. */
  code: string;
  /** facilities.access_permission_required; always false for entity-level targets. */
  accessPermissionRequired: boolean;
}

export interface AssessmentHistoryRow {
  entityId: string;
  facilityId: string | null;
  auditNumber: number;
  approvedAt: string | null;
  createdAt: string;
  id: string;
}

export interface NewAssessmentRow {
  module: DbModule;
  cycle_id: string;
  entity_id: string;
  facility_id: string | null;
  template_id: string;
  subject_code: string;
  audit_number: number;
  assessment_type: "initial";
  previous_assessment_id: string | null;
  permission_required: boolean;
}

/**
 * The data access this module needs, and nothing else — small enough that
 * a genuine Postgres-backed adapter (tests/db/generate-cycle.perf.test.ts)
 * and the real Supabase adapter below can both implement it directly, so
 * the bulk-generation *algorithm* (the part the 95-facilities-under-5-
 * seconds acceptance criterion is actually about) is exercised against a
 * real database in tests, not just mocked. See docs/decisions.md.
 */
export interface GenerateCycleDb {
  activeTargets(module: DbModule): Promise<GenerateCycleTarget[]>;
  activeTemplateId(module: DbModule): Promise<string>;
  /** Every (non-deleted) assessment for this module, for any of these entity ids, across all cycles. */
  history(module: DbModule, entityIds: string[]): Promise<AssessmentHistoryRow[]>;
  /** Keys (targetKey) of targets that already have an assessment in this cycle+module. */
  existingInCycle(cycleId: string, module: DbModule): Promise<Set<string>>;
  insertAssessments(rows: NewAssessmentRow[]): Promise<number>;
}

export function targetKey(entityId: string, facilityId: string | null): string {
  return `${entityId}:${facilityId ?? ""}`;
}

export interface GenerateAssessmentSetInput {
  cycleId: string;
  /** The cycle's year — the subject code's YEAR component. */
  cycleYear: number;
  module: DbModule;
}

export interface GenerateAssessmentSetResult {
  created: number;
  skipped: number;
}

/**
 * Bulk-creates one assessment per active entity/facility for a module that
 * doesn't already have one in this cycle. Exactly five data-access calls
 * regardless of how many targets there are (activeTargets, activeTemplateId,
 * existingInCycle, history, one bulk insertAssessments) — the acceptance
 * criterion ("95 facilities in under 5 seconds") is a property of that
 * fixed round-trip count, not of anything that scales with N. See
 * docs/decisions.md.
 *
 * Every assessment created here is assessment_type "initial" (a standard
 * scheduled audit) with a whole-number audit_number — decimal follow-up
 * audits are a separate, targeted action outside of bulk cycle generation
 * (lib/scheduling/subject-code.ts's nextAuditNumber still supports them;
 * this function just never asks for one).
 */
export async function generateAssessmentSet(
  db: GenerateCycleDb,
  input: GenerateAssessmentSetInput,
): Promise<GenerateAssessmentSetResult> {
  const targets = await db.activeTargets(input.module);
  if (targets.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const [templateId, existingKeys] = await Promise.all([
    db.activeTemplateId(input.module),
    db.existingInCycle(input.cycleId, input.module),
  ]);

  const remaining = targets.filter((t) => !existingKeys.has(targetKey(t.entityId, t.facilityId)));
  if (remaining.length === 0) {
    return { created: 0, skipped: targets.length };
  }

  const entityIds = Array.from(new Set(remaining.map((t) => t.entityId)));
  const history = await db.history(input.module, entityIds);

  const lastAuditNumberByKey = new Map<string, number>();
  const previousApprovedByKey = new Map<string, { id: string; auditNumber: number; createdAt: string }>();
  for (const row of history) {
    const key = targetKey(row.entityId, row.facilityId);

    const lastSoFar = lastAuditNumberByKey.get(key);
    if (lastSoFar === undefined || row.auditNumber > lastSoFar) {
      lastAuditNumberByKey.set(key, row.auditNumber);
    }

    if (row.approvedAt !== null) {
      const bestSoFar = previousApprovedByKey.get(key);
      if (
        !bestSoFar ||
        row.auditNumber > bestSoFar.auditNumber ||
        (row.auditNumber === bestSoFar.auditNumber && row.createdAt > bestSoFar.createdAt)
      ) {
        previousApprovedByKey.set(key, { id: row.id, auditNumber: row.auditNumber, createdAt: row.createdAt });
      }
    }
  }

  const rows: NewAssessmentRow[] = remaining.map((target) => {
    const key = targetKey(target.entityId, target.facilityId);
    const auditNumber = nextAuditNumber(lastAuditNumberByKey.get(key), "initial");
    return {
      module: input.module,
      cycle_id: input.cycleId,
      entity_id: target.entityId,
      facility_id: target.facilityId,
      template_id: templateId,
      subject_code: buildSubjectCode({
        year: input.cycleYear,
        module: input.module,
        assessmentType: "initial",
        entityOrFacilityCode: target.code,
        auditNumber,
      }),
      audit_number: auditNumber,
      assessment_type: "initial",
      previous_assessment_id: previousApprovedByKey.get(key)?.id ?? null,
      permission_required: target.accessPermissionRequired,
    };
  });

  const created = await db.insertAssessments(rows);
  return { created, skipped: targets.length - remaining.length };
}

/** Real adapter for app use — wraps a signed-in Supabase client, subject to RLS like any other request. */
export function supabaseGenerateCycleDb(supabase: SupabaseClient): GenerateCycleDb {
  return {
    async activeTargets(module) {
      if (module === "accommodation") {
        const { data, error } = await supabase
          .from("facilities")
          .select("id, entity_id, facility_code, access_permission_required, entities!inner(status)")
          .is("deleted_at", null)
          .eq("entities.status", "active");
        if (error) throw error;
        return (data ?? []).map((f) => ({
          entityId: f.entity_id as string,
          facilityId: f.id as string,
          code: f.facility_code as string,
          accessPermissionRequired: f.access_permission_required as boolean,
        }));
      }

      const { data, error } = await supabase
        .from("entities")
        .select("id, entity_code")
        .eq("status", "active")
        .is("deleted_at", null);
      if (error) throw error;
      return (data ?? []).map((e) => ({
        entityId: e.id as string,
        facilityId: null,
        code: e.entity_code as string,
        accessPermissionRequired: false,
      }));
    },

    async activeTemplateId(module) {
      const { data, error } = await supabase
        .from("checklist_templates")
        .select("id")
        .eq("module", module)
        .eq("is_active", true)
        .is("deleted_at", null)
        .single();
      if (error) throw error;
      return data.id as string;
    },

    async history(module, entityIds) {
      if (entityIds.length === 0) {
        return [];
      }
      const { data, error } = await supabase
        .from("assessments")
        .select("id, entity_id, facility_id, audit_number, approved_at, created_at")
        .eq("module", module)
        .in("entity_id", entityIds)
        .is("deleted_at", null);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        entityId: r.entity_id as string,
        facilityId: (r.facility_id as string | null) ?? null,
        auditNumber: Number(r.audit_number),
        approvedAt: (r.approved_at as string | null) ?? null,
        createdAt: r.created_at as string,
      }));
    },

    async existingInCycle(cycleId, module) {
      const { data, error } = await supabase
        .from("assessments")
        .select("entity_id, facility_id")
        .eq("cycle_id", cycleId)
        .eq("module", module);
      if (error) throw error;
      return new Set((data ?? []).map((r) => targetKey(r.entity_id as string, (r.facility_id as string | null) ?? null)));
    },

    async insertAssessments(rows) {
      if (rows.length === 0) {
        return 0;
      }
      const { data, error } = await supabase.from("assessments").insert(rows).select("id");
      if (error) throw error;
      return data?.length ?? 0;
    },
  };
}
