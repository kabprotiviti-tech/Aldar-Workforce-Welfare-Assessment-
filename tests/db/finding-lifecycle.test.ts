import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_DATABASE_URL, isReachable, resetAndMigrate } from "./helpers";

/**
 * Acceptance criteria (this prompt, finding lifecycle management):
 * - "Closing a finding requires closure evidence and a reviewer
 *   decision; neither can be skipped."
 * - "A finding cannot be edited after closure; only reopened, which
 *   creates a new event."
 *
 * Both are enforced by 0029_finding_lifecycle.sql's own triggers, not
 * only by lib/findings/actions.ts's validation — the same reasoning as
 * tests/db/assessment-decision.test.ts: the admin pool below *is* the
 * privileged path (table owner, bypassing RLS entirely), and it still
 * cannot get around either rule.
 */
const pool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(pool);

if (!reachable) {
  console.warn(`Skipping finding lifecycle test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("finding lifecycle guarantees against a real database", () => {
  let assessorId: string;
  let entityId: string;
  let assessmentItemId: string;
  let assessmentId: string;

  async function createFinding(status = "in_progress"): Promise<string> {
    const result = await pool.query<{ id: string }>(
      "insert into public.findings (assessment_item_id, entity_id, title, priority, status, created_by) values ($1, $2, 'Test finding', 'medium', $3, $4) returning id",
      [assessmentItemId, entityId, status, assessorId],
    );
    return result.rows[0]!.id;
  }

  async function attachEvidence(findingId: string): Promise<void> {
    await pool.query(
      "insert into public.evidence_files (assessment_id, finding_id, storage_path, original_name, mime_type, size_bytes, uploaded_by) values ($1, $2, 'x', 'x.pdf', 'application/pdf', 1, $3)",
      [assessmentId, findingId, assessorId],
    );
  }

  beforeAll(async () => {
    await resetAndMigrate(pool);

    const assessor = await pool.query<{ id: string }>("insert into auth.users default values returning id");
    assessorId = assessor.rows[0]!.id;
    await pool.query("insert into public.users (id, full_name, role, active) values ($1, 'Test assessor', 'assessor', true)", [assessorId]);

    const cycle = await pool.query<{ id: string }>("insert into public.cycles (year, name) values (2026, 'Lifecycle cycle') returning id");
    const template = await pool.query<{ id: string }>(
      "select id from public.checklist_templates where module = 'employment_practices' and is_active limit 1",
    );
    const requirement = await pool.query<{ id: string }>("select id from public.requirements where template_id = $1 and sl_no = 5", [
      template.rows[0]!.id,
    ]);
    const entity = await pool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Lifecycle Entity', 'LIFE-1', 'general_contractor') returning id",
    );
    entityId = entity.rows[0]!.id;

    const assessment = await pool.query<{ id: string }>(
      `insert into public.assessments (module, cycle_id, entity_id, template_id, subject_code, assessment_type)
       values ('employment_practices', $1, $2, $3, '2026-EP-IN-LIFE-1', 'initial') returning id`,
      [cycle.rows[0]!.id, entityId, template.rows[0]!.id],
    );
    assessmentId = assessment.rows[0]!.id;

    const item = await pool.query<{ id: string }>(
      "insert into public.assessment_items (assessment_id, requirement_id) values ($1, $2) returning id",
      [assessmentId, requirement.rows[0]!.id],
    );
    assessmentItemId = item.rows[0]!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("refuses to close a finding with no reviewer decision", async () => {
    const findingId = await createFinding();
    await attachEvidence(findingId);

    await expect(pool.query("update public.findings set status = 'closed' where id = $1", [findingId])).rejects.toThrow(
      /can only be closed once a reviewer accepts/,
    );
  });

  it("refuses to close a finding accepted by a reviewer but with no closure evidence", async () => {
    const findingId = await createFinding();

    await expect(
      pool.query("update public.findings set reviewer_decision = 'accepted', status = 'closed' where id = $1", [findingId]),
    ).rejects.toThrow(/cannot be closed without closure evidence/);
  });

  it("refuses a rejected review decision to close the finding", async () => {
    const findingId = await createFinding();
    await attachEvidence(findingId);

    await expect(
      pool.query("update public.findings set reviewer_decision = 'rejected', status = 'closed' where id = $1", [findingId]),
    ).rejects.toThrow(/can only be closed once a reviewer accepts/);
  });

  it("closes once both closure evidence and an accepted review decision are present, stamping closed_at", async () => {
    const findingId = await createFinding();
    await attachEvidence(findingId);

    await pool.query("update public.findings set reviewer_decision = 'accepted', status = 'closed' where id = $1", [findingId]);

    const { rows } = await pool.query("select status, closed_at from public.findings where id = $1", [findingId]);
    expect(rows[0]!.status).toBe("closed");
    expect(rows[0]!.closed_at).not.toBeNull();
  });

  it("refuses to edit any field on a closed finding", async () => {
    const findingId = await createFinding();
    await attachEvidence(findingId);
    await pool.query("update public.findings set reviewer_decision = 'accepted', status = 'closed' where id = $1", [findingId]);

    await expect(pool.query("update public.findings set title = 'Edited title' where id = $1", [findingId])).rejects.toThrow(
      /closed finding cannot be edited/,
    );
    await expect(pool.query("update public.findings set priority = 'high' where id = $1", [findingId])).rejects.toThrow(
      /closed finding cannot be edited/,
    );
  });

  it("refuses a reopen that smuggles in another field change at the same time", async () => {
    const findingId = await createFinding();
    await attachEvidence(findingId);
    await pool.query("update public.findings set reviewer_decision = 'accepted', status = 'closed' where id = $1", [findingId]);

    await expect(
      pool.query("update public.findings set status = 'open', title = 'Sneaky edit' where id = $1", [findingId]),
    ).rejects.toThrow(/closed finding cannot be edited/);
  });

  it("allows a clean reopen, clearing the closure record so the finding needs fresh evidence and a fresh decision", async () => {
    const findingId = await createFinding();
    await attachEvidence(findingId);
    await pool.query("update public.findings set reviewer_decision = 'accepted', status = 'closed' where id = $1", [findingId]);

    await pool.query("update public.findings set status = 'open' where id = $1", [findingId]);

    const { rows } = await pool.query(
      "select status, reviewer_decision, reviewer_decision_reason, reviewer_decision_at, reviewer_decision_by, closed_at from public.findings where id = $1",
      [findingId],
    );
    expect(rows[0]).toMatchObject({
      status: "open",
      reviewer_decision: null,
      reviewer_decision_reason: null,
      reviewer_decision_at: null,
      reviewer_decision_by: null,
      closed_at: null,
    });
  });

  it("dedupes escalation notifications per (finding, kind), the same guard as rfi_reminders_sent", async () => {
    const findingId = await createFinding("open");
    await pool.query("insert into public.finding_escalations_sent (finding_id, kind) values ($1, 'owner_overdue_30')", [findingId]);

    await expect(
      pool.query("insert into public.finding_escalations_sent (finding_id, kind) values ($1, 'owner_overdue_30')", [findingId]),
    ).rejects.toThrow();

    // A different kind for the same finding is a different notification, not a duplicate.
    await pool.query("insert into public.finding_escalations_sent (finding_id, kind) values ($1, 'admin_overdue_60')", [findingId]);
    const { rows } = await pool.query("select kind from public.finding_escalations_sent where finding_id = $1 order by kind", [findingId]);
    expect(rows.map((r) => r.kind)).toEqual(["admin_overdue_60", "owner_overdue_30"]);
  });
});
