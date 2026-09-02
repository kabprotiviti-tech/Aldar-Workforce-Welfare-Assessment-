import { performance } from "node:perf_hooks";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateAssessmentSet, type GenerateCycleDb, type NewAssessmentRow } from "@/lib/scheduling/generate-cycle";
import { buildSubjectCode } from "@/lib/scheduling/subject-code";
import { ADMIN_DATABASE_URL, asUser, authenticatedDatabaseUrl, isReachable, resetAndMigrate } from "./helpers";

/**
 * Acceptance criterion: "Generating a cycle for 95 facilities creates 95
 * assessments with correct codes in under 5 seconds." Runs the real
 * generateAssessmentSet orchestration (lib/scheduling/generate-cycle.ts)
 * against a real local Postgres instance, through RLS, as a real
 * `assessor` — not a mock — so the 5-second budget is measured on the same
 * fixed number of round trips (5, regardless of N) that
 * generate-cycle.test.ts proves architecturally with a fake adapter.
 */
const NEW_ASSESSMENT_COLUMNS = [
  "module",
  "cycle_id",
  "entity_id",
  "facility_id",
  "template_id",
  "subject_code",
  "audit_number",
  "assessment_type",
  "previous_assessment_id",
  "permission_required",
] as const;

function pgGenerateCycleDb(client: PoolClient): GenerateCycleDb {
  return {
    async activeTargets(module) {
      const { rows } = await client.query(
        `select f.id, f.entity_id, f.facility_code, f.access_permission_required
         from public.facilities f
         join public.entities e on e.id = f.entity_id
         where f.deleted_at is null and e.status = 'active' and $1 = 'accommodation'`,
        [module],
      );
      return rows.map((r) => ({
        entityId: r.entity_id,
        facilityId: r.id,
        code: r.facility_code,
        accessPermissionRequired: r.access_permission_required,
      }));
    },
    async activeTemplateId(module) {
      const { rows } = await client.query(
        "select id from public.checklist_templates where module = $1 and is_active = true and deleted_at is null limit 1",
        [module],
      );
      if (rows.length === 0) {
        throw new Error(`No active template for module ${module}`);
      }
      return rows[0].id;
    },
    async history(module, entityIds) {
      const { rows } = await client.query(
        `select id, entity_id, facility_id, audit_number, approved_at, created_at
         from public.assessments
         where module = $1 and entity_id = any($2) and deleted_at is null`,
        [module, entityIds],
      );
      return rows.map((r) => ({
        id: r.id,
        entityId: r.entity_id,
        facilityId: r.facility_id,
        auditNumber: Number(r.audit_number),
        approvedAt: r.approved_at,
        createdAt: r.created_at.toISOString(),
      }));
    },
    async existingInCycle(cycleId, module) {
      const { rows } = await client.query(
        "select entity_id, facility_id from public.assessments where cycle_id = $1 and module = $2",
        [cycleId, module],
      );
      return new Set(rows.map((r) => `${r.entity_id}:${r.facility_id ?? ""}`));
    },
    async insertAssessments(rows: NewAssessmentRow[]) {
      if (rows.length === 0) {
        return 0;
      }
      const values: unknown[] = [];
      const placeholders = rows.map((row, rowIndex) => {
        const cols = NEW_ASSESSMENT_COLUMNS.map((col, colIndex) => {
          values.push(row[col]);
          return `$${rowIndex * NEW_ASSESSMENT_COLUMNS.length + colIndex + 1}`;
        });
        return `(${cols.join(", ")})`;
      });
      const result = await client.query(
        `insert into public.assessments (${NEW_ASSESSMENT_COLUMNS.join(", ")}) values ${placeholders.join(", ")} returning id`,
        values,
      );
      return result.rowCount ?? 0;
    },
  };
}

const adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(adminPool);

if (!reachable) {

  console.warn(`Skipping generate-cycle perf test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("generateAssessmentSet against a real database", () => {
  let authenticatedPool: Pool;
  let assessorId: string;
  let cycle1Id: string;
  let cycle2Id: string;
  let entityIds: string[] = [];
  let historyFacilityIds: string[] = [];
  let historyApprovedAssessmentIds: Map<string, string> = new Map();

  const ENTITY_COUNT = 5;
  const FACILITIES_PER_ENTITY = 19; // 5 * 19 = 95, matching the acceptance criterion exactly.

  beforeAll(async () => {
    await resetAndMigrate(adminPool);
    authenticatedPool = new Pool({ connectionString: authenticatedDatabaseUrl() });

    const assessor = await adminPool.query<{ id: string }>("insert into auth.users default values returning id");
    assessorId = assessor.rows[0]!.id;
    await adminPool.query(
      "insert into public.users (id, full_name, role, active) values ($1, 'Test assessor', 'assessor', true)",
      [assessorId],
    );

    const cycle1 = await adminPool.query<{ id: string }>(
      "insert into public.cycles (year, name) values (2025, 'Perf test cycle 1') returning id",
    );
    cycle1Id = cycle1.rows[0]!.id;
    const cycle2 = await adminPool.query<{ id: string }>(
      "insert into public.cycles (year, name) values (2026, 'Perf test cycle 2') returning id",
    );
    cycle2Id = cycle2.rows[0]!.id;

    const template = await adminPool.query<{ id: string }>(
      "select id from public.checklist_templates where module = 'accommodation' and is_active = true limit 1",
    );
    const templateId = template.rows[0]!.id;

    for (let e = 0; e < ENTITY_COUNT; e++) {
      const entity = await adminPool.query<{ id: string }>(
        "insert into public.entities (name, entity_code, type) values ($1, $2, 'facilities_management') returning id",
        [`Perf Test FM ${e}`, `PERF-FM-${e}`],
      );
      const entityId = entity.rows[0]!.id;
      entityIds.push(entityId);

      const facilityValues: string[] = [];
      const facilityParams: unknown[] = [];
      for (let f = 0; f < FACILITIES_PER_ENTITY; f++) {
        const index = e * FACILITIES_PER_ENTITY + f;
        facilityParams.push(entityId, `Perf Facility ${index}`, `PERF-FAC-${index}`, index % 7 === 0);
        const base = facilityParams.length - 4;
        facilityValues.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
      }
      const inserted = await adminPool.query<{ id: string }>(
        `insert into public.facilities (entity_id, name, facility_code, access_permission_required)
         values ${facilityValues.join(", ")} returning id`,
        facilityParams,
      );

      // Give this entity's first facility a prior, approved cycle-1
      // assessment, so generation for cycle 2 has real history to link to.
      const firstFacilityId = inserted.rows[0]!.id;
      historyFacilityIds.push(firstFacilityId);
      const priorAssessment = await adminPool.query<{ id: string }>(
        `insert into public.assessments
           (module, cycle_id, entity_id, facility_id, template_id, subject_code, audit_number, assessment_type, approved_at)
         values ('accommodation', $1, $2, $3, $4, $5, 1, 'initial', now())
         returning id`,
        [cycle1Id, entityId, firstFacilityId, templateId, `2025-ACM-IN-PERF-FAC-${e * FACILITIES_PER_ENTITY}`],
      );
      historyApprovedAssessmentIds.set(firstFacilityId, priorAssessment.rows[0]!.id);
    }
  });

  afterAll(async () => {
    await authenticatedPool?.end();
    await adminPool.end();
  });

  it("creates 95 assessments with correct codes and links in under 5 seconds", async () => {
    const start = performance.now();

    const result = await asUser(authenticatedPool, assessorId, (client) => {
      const db = pgGenerateCycleDb(client);
      return generateAssessmentSet(db, { cycleId: cycle2Id, cycleYear: 2026, module: "accommodation" });
    });

    const elapsedMs = performance.now() - start;

    expect(result).toEqual({ created: 95, skipped: 0 });
    expect(elapsedMs).toBeLessThan(5000);

    const created = await adminPool.query<{
      facility_id: string;
      facility_code: string;
      audit_number: string;
      subject_code: string;
      previous_assessment_id: string | null;
    }>(
      `select a.facility_id, f.facility_code, a.audit_number, a.subject_code, a.previous_assessment_id
       from public.assessments a
       join public.facilities f on f.id = a.facility_id
       where a.cycle_id = $1`,
      [cycle2Id],
    );
    expect(created.rows).toHaveLength(95);

    for (const row of created.rows) {
      const expectedAuditNumber = historyFacilityIds.includes(row.facility_id) ? 2 : 1;
      const expectedSubjectCode = buildSubjectCode({
        year: 2026,
        module: "accommodation",
        assessmentType: "initial",
        entityOrFacilityCode: row.facility_code,
        auditNumber: expectedAuditNumber,
      });
      expect(Number(row.audit_number)).toBe(expectedAuditNumber);
      expect(row.subject_code).toBe(expectedSubjectCode);
      expect(row.previous_assessment_id).toBe(
        historyFacilityIds.includes(row.facility_id) ? historyApprovedAssessmentIds.get(row.facility_id)! : null,
      );
    }

    // 95 targets really did produce 95 distinct subject codes (the unique
    // constraint on assessments.subject_code would have raised on insert
    // otherwise, but confirm it explicitly).
    expect(new Set(created.rows.map((r) => r.subject_code)).size).toBe(95);
  });
});
