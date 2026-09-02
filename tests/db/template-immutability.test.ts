import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_DATABASE_URL, isReachable, resetAndMigrate } from "./helpers";

/**
 * Acceptance criteria: "Templates are versioned and immutable once an
 * assessment references them" and "creating template v2 does not alter
 * any report already generated against v1, proven by a test."
 *
 * Runs every mutation attempt through the admin (Postgres superuser)
 * connection on purpose: the trigger from 0009_template_immutability.sql
 * fires for every role, including one that would bypass RLS entirely —
 * this is a stronger proof than testing only via `authenticated`.
 */
const pool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(pool);

if (!reachable) {
   
  console.warn(`Skipping template immutability test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("checklist_templates are immutable once referenced by an assessment", () => {
  let templateV1Id: string;
  let requirement1Id: string;
  let reportId: string;
  let assessmentId: string;

  beforeAll(async () => {
    await resetAndMigrate(pool);

    // 0010_seed_checklist_templates_v1.sql already seeds employment_practices
    // versions 1+, so this file's own fixture templates use 101/102/103 to
    // avoid colliding with the real seeded content.
    const template = await pool.query<{ id: string }>(
      `insert into public.checklist_templates (module, version, effective_from, is_active)
       values ('employment_practices', 101, current_date, true) returning id`,
    );
    templateV1Id = template.rows[0]!.id;

    const req1 = await pool.query<{ id: string }>(
      `insert into public.requirements (template_id, sl_no, title, is_key)
       values ($1, 1, 'No discrimination', false) returning id`,
      [templateV1Id],
    );
    requirement1Id = req1.rows[0]!.id;
    await pool.query(
      `insert into public.requirements (template_id, sl_no, title, is_key) values ($1, 2, 'No harassment', false)`,
      [templateV1Id],
    );

    const cycle = await pool.query<{ id: string }>(
      "insert into public.cycles (year, name) values (2026, 'Immutability test cycle') returning id",
    );
    const entity = await pool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Test Entity', 'IMMUT-1', 'general_contractor') returning id",
    );
    const assessment = await pool.query<{ id: string }>(
      `insert into public.assessments (module, cycle_id, entity_id, template_id, subject_code, assessment_type)
       values ('employment_practices', $1, $2, $3, '2026-EP-IN-IMMUT-1', 'initial')
       returning id`,
      [cycle.rows[0]!.id, entity.rows[0]!.id, templateV1Id],
    );
    assessmentId = assessment.rows[0]!.id;

    await pool.query("insert into public.assessment_items (assessment_id, requirement_id) values ($1, $2)", [
      assessmentId,
      requirement1Id,
    ]);

    const report = await pool.query<{ id: string }>(
      `insert into public.reports (assessment_id, version, format, storage_path, is_current)
       values ($1, 1, 'pdf', 's3://reports/v1.pdf', true) returning id`,
      [assessmentId],
    );
    reportId = report.rows[0]!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("blocks editing a v1 requirement's title", async () => {
    await expect(
      pool.query("update public.requirements set title = 'Changed' where id = $1", [requirement1Id]),
    ).rejects.toThrow(/immutable/i);
  });

  it("blocks deleting a v1 requirement", async () => {
    await expect(pool.query("delete from public.requirements where id = $1", [requirement1Id])).rejects.toThrow(
      /immutable/i,
    );
  });

  it("blocks adding a new requirement to the in-use v1 template", async () => {
    await expect(
      pool.query(
        "insert into public.requirements (template_id, sl_no, title) values ($1, 3, 'New requirement')",
        [templateV1Id],
      ),
    ).rejects.toThrow(/already referenced/i);
  });

  it("blocks a substantive change to the v1 template itself", async () => {
    await expect(
      pool.query("update public.checklist_templates set version = 99 where id = $1", [templateV1Id]),
    ).rejects.toThrow(/immutable/i);
  });

  it("still allows toggling is_active on the v1 template", async () => {
    await expect(
      pool.query("update public.checklist_templates set is_active = false where id = $1", [templateV1Id]),
    ).resolves.toBeDefined();

    const check = await pool.query("select is_active from public.checklist_templates where id = $1", [
      templateV1Id,
    ]);
    expect(check.rows[0]?.is_active).toBe(false);
  });

  it("creating v2 with different content does not alter v1's requirements or report", async () => {
    const templateV2 = await pool.query<{ id: string }>(
      `insert into public.checklist_templates (module, version, effective_from, is_active)
       values ('employment_practices', 102, current_date, true) returning id`,
    );
    await pool.query(
      `insert into public.requirements (template_id, sl_no, title, is_key)
       values ($1, 1, 'No discrimination or harassment (merged)', true)`,
      [templateV2.rows[0]!.id],
    );

    const v1Requirement = await pool.query("select title, is_key from public.requirements where id = $1", [
      requirement1Id,
    ]);
    expect(v1Requirement.rows[0]).toEqual({ title: "No discrimination", is_key: false });

    const report = await pool.query(
      "select version, storage_path, is_current from public.reports where id = $1",
      [reportId],
    );
    expect(report.rows[0]).toEqual({ version: 1, storage_path: "s3://reports/v1.pdf", is_current: true });

    const assessment = await pool.query("select template_id from public.assessments where id = $1", [
      assessmentId,
    ]);
    expect(assessment.rows[0]?.template_id).toBe(templateV1Id);
  });

  it("a template not yet referenced by any assessment can still be freely edited", async () => {
    const draft = await pool.query<{ id: string }>(
      `insert into public.checklist_templates (module, version, effective_from, is_active)
       values ('employment_practices', 103, current_date, false) returning id`,
    );
    const req = await pool.query<{ id: string }>(
      `insert into public.requirements (template_id, sl_no, title) values ($1, 1, 'Draft requirement') returning id`,
      [draft.rows[0]!.id],
    );

    await expect(
      pool.query("update public.requirements set title = 'Edited draft requirement' where id = $1", [
        req.rows[0]!.id,
      ]),
    ).resolves.toBeDefined();
  });
});
