import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeCoverage, requirementsWithNoEvidence } from "@/lib/evidence/coverage";
import { ADMIN_DATABASE_URL, asUser, authenticatedDatabaseUrl, isReachable, resetAndMigrate } from "./helpers";

/**
 * Acceptance criterion: "Coverage view correctly lists requirements with
 * zero linked evidence." Seeds a template with three requirements, links
 * evidence to two of them via evidence_file_requirements
 * (0017_evidence_review_and_requirements.sql), then reads that data back
 * as a real `assessor` through RLS and runs it through the same pure
 * lib/evidence/coverage.ts functions the UI uses — proving both the RLS
 * policies and the coverage logic together, not the pure function alone.
 */
const adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(adminPool);

if (!reachable) {

  console.warn(`Skipping evidence coverage test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("evidence coverage against a real database", () => {
  let authenticatedPool: Pool;
  let assessorId: string;
  let assessmentId: string;
  let requirementIds: string[];

  beforeAll(async () => {
    await resetAndMigrate(adminPool);
    authenticatedPool = new Pool({ connectionString: authenticatedDatabaseUrl() });

    const assessor = await adminPool.query<{ id: string }>("insert into auth.users default values returning id");
    assessorId = assessor.rows[0]!.id;
    await adminPool.query(
      "insert into public.users (id, full_name, role, active) values ($1, 'Test assessor', 'assessor', true)",
      [assessorId],
    );

    const cycle = await adminPool.query<{ id: string }>(
      "insert into public.cycles (year, name) values (2026, 'Coverage test cycle') returning id",
    );
    const template = await adminPool.query<{ id: string }>(
      `insert into public.checklist_templates (module, version, effective_from, is_active)
       values ('employment_practices', 301, current_date, true) returning id`,
    );
    const requirements = await adminPool.query<{ id: string }>(
      `insert into public.requirements (template_id, sl_no, title)
       values ($1, 1, 'First requirement'), ($1, 2, 'Second requirement'), ($1, 3, 'Third requirement')
       returning id`,
      [template.rows[0]!.id],
    );
    requirementIds = requirements.rows.map((r) => r.id);

    const entity = await adminPool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Coverage Test Entity', 'COV-1', 'general_contractor') returning id",
    );

    const assessment = await adminPool.query<{ id: string }>(
      `insert into public.assessments (module, cycle_id, entity_id, template_id, subject_code, assessment_type)
       values ('employment_practices', $1, $2, $3, '2026-EP-IN-COV-1', 'initial')
       returning id`,
      [cycle.rows[0]!.id, entity.rows[0]!.id, template.rows[0]!.id],
    );
    assessmentId = assessment.rows[0]!.id;

    // Two evidence files, together covering requirements 1 and 2 — requirement 3 gets none.
    const fileA = await adminPool.query<{ id: string }>(
      `insert into public.evidence_files (assessment_id, storage_path, original_name, mime_type, size_bytes, uploaded_by)
       values ($1, 'evidence/test/a.pdf', 'a.pdf', 'application/pdf', 1024, $2) returning id`,
      [assessmentId, assessorId],
    );
    const fileB = await adminPool.query<{ id: string }>(
      `insert into public.evidence_files (assessment_id, storage_path, original_name, mime_type, size_bytes, uploaded_by)
       values ($1, 'evidence/test/b.pdf', 'b.pdf', 'application/pdf', 2048, $2) returning id`,
      [assessmentId, assessorId],
    );
    await adminPool.query(
      "insert into public.evidence_file_requirements (evidence_file_id, requirement_id) values ($1, $2), ($3, $4)",
      [fileA.rows[0]!.id, requirementIds[0], fileB.rows[0]!.id, requirementIds[1]],
    );
  });

  afterAll(async () => {
    await authenticatedPool?.end();
    await adminPool.end();
  });

  it("computes coverage from real evidence_file_requirements rows read through RLS", async () => {
    const requirementsResult = await asUser(authenticatedPool, assessorId, (client) =>
      client.query<{ id: string; sl_no: number; title: string }>(
        "select id, sl_no, title from public.requirements where template_id = (select template_id from public.assessments where id = $1) order by sl_no",
        [assessmentId],
      ),
    );
    const linkedResult = await asUser(authenticatedPool, assessorId, (client) =>
      client.query<{ requirement_id: string }>(
        `select distinct r.requirement_id
         from public.evidence_file_requirements r
         join public.evidence_files f on f.id = r.evidence_file_id
         where f.assessment_id = $1`,
        [assessmentId],
      ),
    );

    const coverage = computeCoverage(
      requirementsResult.rows.map((r) => ({ requirementId: r.id, slNo: r.sl_no, title: r.title })),
      new Set(linkedResult.rows.map((r) => r.requirement_id)),
    );

    expect(coverage).toEqual([
      { requirementId: requirementIds[0], slNo: 1, title: "First requirement", hasEvidence: true },
      { requirementId: requirementIds[1], slNo: 2, title: "Second requirement", hasEvidence: true },
      { requirementId: requirementIds[2], slNo: 3, title: "Third requirement", hasEvidence: false },
    ]);

    const gaps = requirementsWithNoEvidence(coverage);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.requirementId).toBe(requirementIds[2]);
    expect(gaps[0]!.title).toBe("Third requirement");
  });

  it("lists every requirement as a gap when no evidence has been linked at all", async () => {
    const otherEntity = await adminPool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Coverage Test Entity 2', 'COV-2', 'general_contractor') returning id",
    );
    const template = await adminPool.query<{ template_id: string }>(
      "select template_id from public.assessments where id = $1",
      [assessmentId],
    );
    const cycle = await adminPool.query<{ cycle_id: string }>("select cycle_id from public.assessments where id = $1", [assessmentId]);
    const otherAssessment = await adminPool.query<{ id: string }>(
      `insert into public.assessments (module, cycle_id, entity_id, template_id, subject_code, assessment_type)
       values ('employment_practices', $1, $2, $3, '2026-EP-IN-COV-2', 'initial')
       returning id`,
      [cycle.rows[0]!.cycle_id, otherEntity.rows[0]!.id, template.rows[0]!.template_id],
    );

    const requirementsResult = await asUser(authenticatedPool, assessorId, (client) =>
      client.query<{ id: string; sl_no: number; title: string }>(
        "select id, sl_no, title from public.requirements where template_id = $1 order by sl_no",
        [template.rows[0]!.template_id],
      ),
    );
    const linkedResult = await asUser(authenticatedPool, assessorId, (client) =>
      client.query<{ requirement_id: string }>(
        `select distinct r.requirement_id
         from public.evidence_file_requirements r
         join public.evidence_files f on f.id = r.evidence_file_id
         where f.assessment_id = $1`,
        [otherAssessment.rows[0]!.id],
      ),
    );

    const coverage = computeCoverage(
      requirementsResult.rows.map((r) => ({ requirementId: r.id, slNo: r.sl_no, title: r.title })),
      new Set(linkedResult.rows.map((r) => r.requirement_id)),
    );

    expect(requirementsWithNoEvidence(coverage)).toHaveLength(3);
  });
});
