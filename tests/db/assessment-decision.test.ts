import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateItemDecision } from "@/lib/assessment/decision";
import { ADMIN_DATABASE_URL, asUser, authenticatedDatabaseUrl, isReachable, resetAndMigrate } from "./helpers";

/**
 * Acceptance criteria (this prompt):
 * - "A status cannot be written by any code path other than an
 *   authenticated assessor action. Prove it with a test that attempts a
 *   service-level write and fails."
 * - "Draft text survives a browser refresh."
 *
 * The first is the reason the guarantee is a trigger rather than an RLS
 * policy: the service-role client and the table owner both bypass RLS by
 * design, so a policy would be a promise the app's own privileged code
 * could break. The admin pool below *is* the privileged path — it is the
 * table owner, connecting as a superuser — and it still cannot set a
 * status.
 */
const pool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(pool);

if (!reachable) {
  console.warn(`Skipping assessment decision test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("assessment decisions against a real database", () => {
  let authenticatedPool: Pool;
  let assessorId: string;
  let viewerId: string;
  let itemId: string;

  beforeAll(async () => {
    await resetAndMigrate(pool);
    authenticatedPool = new Pool({ connectionString: authenticatedDatabaseUrl() });

    const assessor = await pool.query<{ id: string }>("insert into auth.users default values returning id");
    assessorId = assessor.rows[0]!.id;
    await pool.query("insert into public.users (id, full_name, role, active) values ($1, 'Test assessor', 'assessor', true)", [assessorId]);

    const viewer = await pool.query<{ id: string }>("insert into auth.users default values returning id");
    viewerId = viewer.rows[0]!.id;
    await pool.query("insert into public.users (id, full_name, role, active) values ($1, 'Test viewer', 'client_viewer', true)", [viewerId]);

    const cycle = await pool.query<{ id: string }>("insert into public.cycles (year, name) values (2026, 'Decision cycle') returning id");
    const template = await pool.query<{ id: string }>(
      "select id from public.checklist_templates where module = 'employment_practices' and is_active limit 1",
    );
    const requirement = await pool.query<{ id: string }>("select id from public.requirements where template_id = $1 and sl_no = 11", [
      template.rows[0]!.id,
    ]);
    const entity = await pool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Decision Entity', 'DEC-1', 'general_contractor') returning id",
    );
    const assessment = await pool.query<{ id: string }>(
      `insert into public.assessments (module, cycle_id, entity_id, template_id, subject_code, assessment_type)
       values ('employment_practices', $1, $2, $3, '2026-EP-IN-DEC-1', 'initial') returning id`,
      [cycle.rows[0]!.id, entity.rows[0]!.id, template.rows[0]!.id],
    );
    const item = await pool.query<{ id: string }>(
      "insert into public.assessment_items (assessment_id, requirement_id) values ($1, $2) returning id",
      [assessment.rows[0]!.id, requirement.rows[0]!.id],
    );
    itemId = item.rows[0]!.id;
  });

  afterAll(async () => {
    await authenticatedPool.end();
    await pool.end();
  });

  it("refuses a service-level status write — the privileged path cannot decide", async () => {
    await expect(
      pool.query("update public.assessment_items set compliance_status = 'Compliant' where id = $1", [itemId]),
    ).rejects.toThrow(/can only be set by an authenticated assessor/);

    const { rows } = await pool.query("select compliance_status, decided_by, decided_at from public.assessment_items where id = $1", [itemId]);
    expect(rows[0]).toEqual({ compliance_status: null, decided_by: null, decided_at: null });
  });

  it("refuses a status smuggled in at insert time", async () => {
    const assessment = await pool.query<{ id: string }>("select assessment_id from public.assessment_items where id = $1", [itemId]);
    const requirement = await pool.query<{ id: string }>(
      `select r.id from public.requirements r
       join public.checklist_templates t on t.id = r.template_id
       where t.module = 'employment_practices' and t.is_active and r.sl_no = 12`,
    );

    await expect(
      pool.query(
        `insert into public.assessment_items (assessment_id, requirement_id, compliance_status) values ($1, $2, 'Compliant')`,
        [(assessment.rows[0] as unknown as { assessment_id: string }).assessment_id, requirement.rows[0]!.id],
      ),
    ).rejects.toThrow(/cannot be created with a compliance_status/);
  });

  it("refuses a client_viewer, even with a real authenticated session", async () => {
    // RLS gets there first for this one: assessment_items_update_staff
    // filters the row out, so the update matches nothing and the trigger
    // never fires. Asserting the outcome rather than which layer caught
    // it — no status is written either way, and both layers have to hold.
    const result = await asUser(authenticatedPool, viewerId, (client) =>
      client.query("update public.assessment_items set compliance_status = 'Compliant' where id = $1", [itemId]),
    );
    expect(result.rowCount).toBe(0);

    const { rows } = await pool.query("select compliance_status, decided_by from public.assessment_items where id = $1", [itemId]);
    expect(rows[0]).toEqual({ compliance_status: null, decided_by: null });
  });

  it("refuses a signed-in user whose role cannot write operationally, at the trigger", async () => {
    // A qa_reviewer passes is_staff() and so passes the RLS update
    // policy, but can_write_operational() excludes them — this is the
    // case the trigger itself catches.
    const reviewer = await pool.query<{ id: string }>("insert into auth.users default values returning id");
    const reviewerId = reviewer.rows[0]!.id;
    await pool.query("insert into public.users (id, full_name, role, active) values ($1, 'Test QA reviewer', 'qa_reviewer', true)", [reviewerId]);

    await expect(
      asUser(authenticatedPool, reviewerId, (client) =>
        client.query("update public.assessment_items set compliance_status = 'Compliant' where id = $1", [itemId]),
      ),
    ).rejects.toThrow(/can only be set by an admin or assessor/);

    const { rows } = await pool.query("select compliance_status from public.assessment_items where id = $1", [itemId]);
    expect(rows[0]!.compliance_status).toBeNull();
  });

  it("lets an authenticated assessor decide, stamping decided_by and decided_at", async () => {
    await asUser(authenticatedPool, assessorId, (client) =>
      client.query("update public.assessment_items set compliance_status = 'Partial', action_required = 'Transfer April wages.' where id = $1", [
        itemId,
      ]),
    );

    const { rows } = await pool.query("select compliance_status, decided_by, decided_at, action_required from public.assessment_items where id = $1", [
      itemId,
    ]);
    expect(rows[0]!.compliance_status).toBe("Partial");
    expect(rows[0]!.decided_by).toBe(assessorId);
    expect(rows[0]!.decided_at).not.toBeNull();
    expect(rows[0]!.action_required).toBe("Transfer April wages.");
  });

  it("writes an audit_log row for the decision, in the same transaction", async () => {
    const { rows } = await pool.query(
      "select actor_id, action, entity_type, before, after from public.audit_log where entity_id = $1 order by created_at desc",
      [itemId],
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ actor_id: assessorId, action: "assessment_item.decide", entity_type: "assessment_item" });
    expect(rows[0]!.after).toMatchObject({ compliance_status: "Partial" });
  });

  it("stamps a fresh decided_at when the status changes again", async () => {
    const before = await pool.query("select decided_at from public.assessment_items where id = $1", [itemId]);

    await asUser(authenticatedPool, assessorId, (client) =>
      client.query("update public.assessment_items set compliance_status = 'Compliant', action_required = null where id = $1", [itemId]),
    );

    const after = await pool.query("select decided_at, compliance_status from public.assessment_items where id = $1", [itemId]);
    expect(after.rows[0]!.compliance_status).toBe("Compliant");
    expect(new Date(after.rows[0]!.decided_at).getTime()).toBeGreaterThanOrEqual(new Date(before.rows[0]!.decided_at).getTime());
  });

  it("leaves drafting and detail capture untouched by the guard", async () => {
    // The trigger only fires on a status change, so autosave from a
    // service path or a background job is unaffected.
    await pool.query(
      "update public.assessment_items set assessor_observations = 'Working note', evidence_detail = '{\"salaryTransferDates\": []}'::jsonb where id = $1",
      [itemId],
    );

    const { rows } = await pool.query("select assessor_observations from public.assessment_items where id = $1", [itemId]);
    expect(rows[0]!.assessor_observations).toBe("Working note");
  });

  it("keeps an autosaved draft on the server, so it survives a refresh", async () => {
    const draft = "Sampled 12 of 120 payslips; April transfer on 16 May, one day late.";

    await asUser(authenticatedPool, assessorId, (client) =>
      client.query("update public.assessment_items set assessor_observations = $2, draft_updated_at = now() where id = $1", [itemId, draft]),
    );

    // A refresh is a fresh read of the row — a new connection, no client
    // state. This is that read.
    const reread = await pool.query("select assessor_observations, draft_updated_at from public.assessment_items where id = $1", [itemId]);
    expect(reread.rows[0]!.assessor_observations).toBe(draft);
    expect(reread.rows[0]!.draft_updated_at).not.toBeNull();
  });

  it("keeps interview insights out of a client_viewer's reach entirely", async () => {
    await asUser(authenticatedPool, assessorId, (client) =>
      client.query(
        `insert into public.interview_insights (assessment_item_id, workers_interviewed_count, nationalities, interpreter_used, notes, created_by)
         values ($1, 6, array['India','Nepal'], true, 'Workers raised concerns about overtime pay.', $2)`,
        [itemId, assessorId],
      ),
    );

    const staffRead = await asUser(authenticatedPool, assessorId, (client) =>
      client.query("select notes from public.interview_insights where assessment_item_id = $1", [itemId]),
    );
    expect(staffRead.rows).toHaveLength(1);

    // No select policy exists for a client_viewer, so the rows are simply
    // not there for them — the entity-visible surface cannot reach them.
    const viewerRead = await asUser(authenticatedPool, viewerId, (client) =>
      client.query("select notes from public.interview_insights where assessment_item_id = $1", [itemId]),
    );
    expect(viewerRead.rows).toHaveLength(0);
  });

  it("agrees with the validation the page runs before it ever attempts a write", () => {
    const blocked = validateItemDecision({
      requirementSlNo: 11,
      requirementTitle: "Timely wage payment",
      isKey: true,
      status: "Not Compliant",
      remarks: "Wages late in two months.",
      actionRequired: null,
    });

    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.message).toContain("Requirement 11 (Timely wage payment)");
  });
});
