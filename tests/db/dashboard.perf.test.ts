import { performance } from "node:perf_hooks";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_DATABASE_URL, asUser, authenticatedDatabaseUrl, isReachable, resetAndMigrate } from "./helpers";

/**
 * Acceptance criterion: "dashboards must load under 1.5s on a
 * 185-assessment cycle." lib/dashboard/executive-supabase.ts and
 * lib/dashboard/signals-supabase.ts read through a real
 * @supabase/supabase-js client (PostgREST), which this local Postgres
 * stand-in has no equivalent of — the same limitation already accepted
 * for every other *-supabase.ts adapter in this codebase (see
 * docs/decisions.md). pgExecutiveOverviewQueries below mirrors that
 * adapter's exact query sequence as raw SQL, run through RLS as a real
 * assessor, timed end to end against a real 185-assessment cycle —
 * proving the *shape* of the read (the joins, the indexes added in
 * 0034_dashboard_indexes.sql) meets budget, independent of the
 * PostgREST round trip itself.
 */
async function pgExecutiveOverviewQueries(client: PoolClient, cycleId: string): Promise<{ assessmentCount: number }> {
  const assessments = await client.query(
    `select id, subject_code, confirmed_visit_date, actual_visit_date, issued_at, report_due_date
     from public.assessments where cycle_id = $1 and deleted_at is null`,
    [cycleId],
  );
  const assessmentIds = assessments.rows.map((r) => r.id as string);

  await client.query(`select assessment_id, status from public.rfi_requests where assessment_id = any($1)`, [assessmentIds]);

  const items = await client.query(`select id, assessment_id, compliance_status from public.assessment_items where assessment_id = any($1)`, [assessmentIds]);
  const itemIds = items.rows.map((r) => r.id as string);

  await client.query(`select status, assessment_item_id from public.findings where assessment_item_id = any($1) and deleted_at is null`, [itemIds]);

  // --- lib/dashboard/signals-supabase.ts's own, separate fetch ---
  const items2 = await client.query(`select id, assessment_id, quantitative from public.assessment_items where assessment_id = any($1)`, [assessmentIds]);
  const itemIds2 = items2.rows.map((r) => r.id as string);

  await client.query(
    `select id, status, due_date, title, repeat_of_finding_id, assessment_item_id from public.findings where assessment_item_id = any($1) and deleted_at is null`,
    [itemIds2],
  );
  await client.query(
    `select id, original_name, assessment_id from public.evidence_files where assessment_id = any($1) and review_status in ('received', 'in_review')`,
    [assessmentIds],
  );

  return { assessmentCount: assessments.rows.length };
}

const adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(adminPool);

if (!reachable) {
  console.warn(`Skipping dashboard perf test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("the executive dashboard's underlying queries against a real database", () => {
  let authenticatedPool: Pool;
  let assessorId: string;
  let cycleId: string;

  const ASSESSMENT_COUNT = 185;

  beforeAll(async () => {
    await resetAndMigrate(adminPool);
    authenticatedPool = new Pool({ connectionString: authenticatedDatabaseUrl() });

    const assessor = await adminPool.query<{ id: string }>("insert into auth.users default values returning id");
    assessorId = assessor.rows[0]!.id;
    await adminPool.query("insert into public.users (id, full_name, role, active) values ($1, 'Test assessor', 'assessor', true)", [assessorId]);

    const cycle = await adminPool.query<{ id: string }>("insert into public.cycles (year, name) values (2026, 'Dashboard perf cycle') returning id");
    cycleId = cycle.rows[0]!.id;

    const entity = await adminPool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Dashboard Perf Co', 'DASH-PERF-1', 'general_contractor') returning id",
    );
    const entityId = entity.rows[0]!.id;

    const template = await adminPool.query<{ id: string }>(
      "select id from public.checklist_templates where module = 'employment_practices' and is_active = true limit 1",
    );
    const templateId = template.rows[0]!.id;

    await adminPool.query(
      `insert into public.assessments (module, cycle_id, entity_id, template_id, subject_code, assessment_type, owner_id, report_due_date)
       select 'employment_practices', $1, $2, $3, '2026-EP-IN-DASH-' || gs, 'initial', $4, current_date + 10
       from generate_series(1, $5) as gs`,
      [cycleId, entityId, templateId, assessorId, ASSESSMENT_COUNT],
    );

    // One assessment_item per requirement per assessment (23 EP
    // requirements), the real shape a full cycle actually has.
    await adminPool.query(
      `insert into public.assessment_items (assessment_id, requirement_id)
       select a.id, r.id from public.assessments a join public.requirements r on r.template_id = a.template_id where a.cycle_id = $1`,
      [cycleId],
    );

    const contact = await adminPool.query<{ id: string }>(
      "insert into public.entity_contacts (entity_id, name, is_primary) values ($1, 'Contact', true) returning id",
      [entityId],
    );

    // One completed RFI per assessment, and one piece of evidence
    // awaiting review — exercises both signal queries at full cycle scale.
    await adminPool.query(
      `insert into public.rfi_requests (assessment_id, contact_id, status)
       select id, $2, 'completed' from public.assessments where cycle_id = $1`,
      [cycleId, contact.rows[0]!.id],
    );
    await adminPool.query(
      `insert into public.evidence_files (assessment_id, storage_path, original_name, mime_type, size_bytes, document_class, uploaded_by, review_status)
       select id, 'e/' || id || '.pdf', 'evidence.pdf', 'application/pdf', 100, 'rfi_upload', $2, 'received' from public.assessments where cycle_id = $1`,
      [cycleId, assessorId],
    );

    // A finding on every 10th assessment's first item, some repeat-linked.
    const firstItems = await adminPool.query<{ id: string }>(
      `select ai.id from public.assessment_items ai
       join public.assessments a on a.id = ai.assessment_id join public.requirements r on r.id = ai.requirement_id
       where a.cycle_id = $1 and r.sl_no = 1`,
      [cycleId],
    );
    const sampled = firstItems.rows.filter((_, index) => index % 10 === 0);
    for (const item of sampled) {
      await adminPool.query(
        "insert into public.findings (assessment_item_id, entity_id, title, priority, due_date) values ($1, $2, 'Sample finding', 'medium', current_date - 40)",
        [item.id, entityId],
      );
    }
  });

  afterAll(async () => {
    await authenticatedPool?.end();
    await adminPool.end();
  });

  it(`loads a ${ASSESSMENT_COUNT}-assessment cycle's dashboard queries in under 1.5 seconds`, async () => {
    const start = performance.now();
    const result = await asUser(authenticatedPool, assessorId, (client) => pgExecutiveOverviewQueries(client, cycleId));
    const elapsedMs = performance.now() - start;

    expect(result.assessmentCount).toBe(ASSESSMENT_COUNT);
    expect(elapsedMs).toBeLessThan(1500);
  });
});
