import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_DATABASE_URL, asUser, isReachable, resetAndMigrate } from "./helpers";

/**
 * Acceptance criteria (this prompt, the governance layer):
 * - "A locked assessment rejects writes at the database level, not just
 *   in the UI."
 * - "A revision preserves the earlier report file and its data
 *   exactly."
 *
 * Both are 0030_governance.sql's own triggers/RPCs, proven here against
 * a real Postgres instance the same way every other "at the database
 * level" guarantee in this codebase is (tests/db/assessment-decision.test.ts,
 * tests/db/finding-lifecycle.test.ts) — the admin pool below *is* the
 * privileged path (table owner, bypassing RLS entirely) and it still
 * cannot get around either rule.
 */
const pool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(pool);

if (!reachable) {
  console.warn(`Skipping governance test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("governance layer against a real database", () => {
  let adminId: string;
  let assessorId: string;
  let templateId: string;
  let requirementId: string;
  let entityId: string;
  let cycleId: string;
  let scoringWeightsId: string;

  async function createUser(role: string): Promise<string> {
    const user = await pool.query<{ id: string }>("insert into auth.users default values returning id");
    await pool.query("insert into public.users (id, full_name, role, active) values ($1, $2, $3, true)", [user.rows[0]!.id, `Test ${role}`, role]);
    return user.rows[0]!.id;
  }

  async function createAssessment(subjectCode: string): Promise<{ assessmentId: string; itemId: string }> {
    const assessment = await pool.query<{ id: string }>(
      `insert into public.assessments (module, cycle_id, entity_id, template_id, subject_code, assessment_type, actual_visit_date)
       values ('employment_practices', $1, $2, $3, $4, 'initial', '2026-06-01') returning id`,
      [cycleId, entityId, templateId, subjectCode],
    );
    const assessmentId = assessment.rows[0]!.id;
    const item = await pool.query<{ id: string }>(
      "insert into public.assessment_items (assessment_id, requirement_id, was_assessed) values ($1, $2, true) returning id",
      [assessmentId, requirementId],
    );
    const itemId = item.rows[0]!.id;
    await asUser(pool, assessorId, (client) =>
      client.query("update public.assessment_items set compliance_status = 'Compliant', remarks = 'Looks fine.' where id = $1", [itemId]),
    );
    return { assessmentId, itemId };
  }

  /** Drives an assessment all the way to 'approved', returning its item id and the resulting report id. */
  async function approve(subjectCode: string): Promise<{ assessmentId: string; itemId: string; reportId: string }> {
    const { assessmentId, itemId } = await createAssessment(subjectCode);
    await pool.query("update public.assessments set qa_status = 'passed' where id = $1", [assessmentId]);
    const result = await asUser(pool, adminId, (client) =>
      client.query<{ approve_assessment_and_generate_report: string }>(
        "select public.approve_assessment_and_generate_report($1, $2, $3::jsonb, 'json', $4, 'Low', 100, 100) as approve_assessment_and_generate_report",
        [assessmentId, `${assessmentId}/v1.json`, JSON.stringify({ header: { subjectCode }, rows: [] }), scoringWeightsId],
      ),
    );
    return { assessmentId, itemId, reportId: result.rows[0]!.approve_assessment_and_generate_report };
  }

  beforeAll(async () => {
    await resetAndMigrate(pool);

    adminId = await createUser("admin");
    assessorId = await createUser("assessor");

    const cycle = await pool.query<{ id: string }>("insert into public.cycles (year, name) values (2026, 'Governance cycle') returning id");
    cycleId = cycle.rows[0]!.id;

    const template = await pool.query<{ id: string }>(
      "select id from public.checklist_templates where module = 'employment_practices' and is_active limit 1",
    );
    templateId = template.rows[0]!.id;
    const requirement = await pool.query<{ id: string }>("select id from public.requirements where template_id = $1 and sl_no = 1", [templateId]);
    requirementId = requirement.rows[0]!.id;

    const entity = await pool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Governance Entity', 'GOV-1', 'general_contractor') returning id",
    );
    entityId = entity.rows[0]!.id;

    const weights = await pool.query<{ id: string }>("select id from public.scoring_weights where active and deleted_at is null");
    scoringWeightsId = weights.rows[0]!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("QA and approval transitions", () => {
    it("blocks a QA pass while a query is still open", async () => {
      const { assessmentId, itemId } = await createAssessment("2026-EP-IN-GOV-QA1");
      await pool.query(
        "insert into public.qa_queries (assessment_id, assessment_item_id, query_text, raised_by) values ($1, $2, 'Please clarify the sample size.', $3)",
        [assessmentId, itemId, adminId],
      );

      await expect(pool.query("update public.assessments set qa_status = 'passed' where id = $1", [assessmentId])).rejects.toThrow(
        /open query outstanding/,
      );
    });

    it("passing QA stamps qa_completed_at and automatically moves the assessment to client approval", async () => {
      const { assessmentId } = await createAssessment("2026-EP-IN-GOV-QA2");

      await pool.query("update public.assessments set qa_status = 'passed' where id = $1", [assessmentId]);

      const { rows } = await pool.query("select qa_status, qa_completed_at, approval_status from public.assessments where id = $1", [assessmentId]);
      expect(rows[0]!.qa_status).toBe("passed");
      expect(rows[0]!.qa_completed_at).not.toBeNull();
      expect(rows[0]!.approval_status).toBe("awaiting_client");
    });

    it("reopening QA before approval reverts approval_status back to pending", async () => {
      const { assessmentId } = await createAssessment("2026-EP-IN-GOV-QA3");
      await pool.query("update public.assessments set qa_status = 'passed' where id = $1", [assessmentId]);

      await pool.query("update public.assessments set qa_status = 'in_review' where id = $1", [assessmentId]);

      const { rows } = await pool.query("select approval_status, qa_completed_at from public.assessments where id = $1", [assessmentId]);
      expect(rows[0]!.approval_status).toBe("pending");
      expect(rows[0]!.qa_completed_at).toBeNull();
    });

    it("refuses to approve an assessment that never passed QA", async () => {
      const { assessmentId } = await createAssessment("2026-EP-IN-GOV-QA4");

      await expect(pool.query("update public.assessments set approval_status = 'approved' where id = $1", [assessmentId])).rejects.toThrow(
        /only be approved once QA has passed/,
      );
    });

    it("approving stamps approved_at and issued_at", async () => {
      const { assessmentId } = await approve("2026-EP-IN-GOV-QA5");
      const { rows } = await pool.query("select approval_status, approved_at, issued_at from public.assessments where id = $1", [assessmentId]);
      expect(rows[0]!.approval_status).toBe("approved");
      expect(rows[0]!.approved_at).not.toBeNull();
      expect(rows[0]!.issued_at).not.toBeNull();
    });
  });

  describe("assessment_items lock", () => {
    it("cannot become locked while its assessment is not approved", async () => {
      const { itemId } = await createAssessment("2026-EP-IN-GOV-LOCK1");
      await expect(pool.query("update public.assessment_items set locked = true where id = $1", [itemId])).rejects.toThrow(
        /can only be locked once its assessment has been approved/,
      );
    });

    it("locks every item once the assessment is approved", async () => {
      const { itemId } = await approve("2026-EP-IN-GOV-LOCK2");
      const { rows } = await pool.query("select locked from public.assessment_items where id = $1", [itemId]);
      expect(rows[0]!.locked).toBe(true);
    });

    it("rejects a write to a locked item — the database level, not just the UI", async () => {
      const { itemId } = await approve("2026-EP-IN-GOV-LOCK3");
      await expect(pool.query("update public.assessment_items set remarks = 'Sneaky edit' where id = $1", [itemId])).rejects.toThrow(
        /locked assessment item cannot be edited/,
      );
    });

    it("rejects even a no-op write that only changes locked to something other than false", async () => {
      const { itemId } = await approve("2026-EP-IN-GOV-LOCK4");
      await expect(pool.query("update public.assessment_items set locked = true where id = $1", [itemId])).rejects.toThrow(
        /locked assessment item cannot be edited/,
      );
    });
  });

  describe("assessments lock", () => {
    it("rejects a write to an approved assessment", async () => {
      const { assessmentId } = await approve("2026-EP-IN-GOV-LOCK5");
      await expect(pool.query("update public.assessments set risk_rating = 'High' where id = $1", [assessmentId])).rejects.toThrow(
        /approved assessment is locked/,
      );
    });

    it("rejects a reopen attempt that smuggles in another field change", async () => {
      const { assessmentId } = await approve("2026-EP-IN-GOV-LOCK6");
      await expect(
        pool.query(
          "update public.assessments set approval_status = 'pending', qa_status = 'not_started', approved_at = null, qa_completed_at = null, revision_number = revision_number + 1, risk_rating = 'High' where id = $1",
          [assessmentId],
        ),
      ).rejects.toThrow(/approved assessment is locked/);
    });
  });

  describe("reports immutability", () => {
    it("rejects any edit to a report other than is_current", async () => {
      const { reportId } = await approve("2026-EP-IN-GOV-REPORT1");
      await expect(pool.query("update public.reports set storage_path = 'tampered.json' where id = $1", [reportId])).rejects.toThrow(
        /report cannot be edited/,
      );
    });

    it("allows flipping is_current", async () => {
      const { reportId } = await approve("2026-EP-IN-GOV-REPORT2");
      await pool.query("update public.reports set is_current = false where id = $1", [reportId]);
      const { rows } = await pool.query("select is_current from public.reports where id = $1", [reportId]);
      expect(rows[0]!.is_current).toBe(false);
    });
  });

  describe("approve_assessment_and_generate_report RPC", () => {
    it("refuses a non-admin", async () => {
      const { assessmentId } = await createAssessment("2026-EP-IN-GOV-RPC1");
      await pool.query("update public.assessments set qa_status = 'passed' where id = $1", [assessmentId]);
      const assessorId = await createUser("assessor");

      await expect(
        asUser(pool, assessorId, (client) =>
          client.query("select public.approve_assessment_and_generate_report($1, 'x', '{}'::jsonb, 'json', $2, 'Low', 100, 100)", [
            assessmentId,
            scoringWeightsId,
          ]),
        ),
      ).rejects.toThrow(/only an admin may approve/);
    });

    it("refuses an assessment not awaiting client approval", async () => {
      const { assessmentId } = await createAssessment("2026-EP-IN-GOV-RPC2");
      await expect(
        asUser(pool, adminId, (client) =>
          client.query("select public.approve_assessment_and_generate_report($1, 'x', '{}'::jsonb, 'json', $2, 'Low', 100, 100)", [
            assessmentId,
            scoringWeightsId,
          ]),
        ),
      ).rejects.toThrow(/only be approved once QA has passed/);
    });

    it("inserts the report at version = revision_number and marks it current", async () => {
      const { assessmentId, reportId } = await approve("2026-EP-IN-GOV-RPC3");
      const { rows } = await pool.query("select assessment_id, version, is_current, format from public.reports where id = $1", [reportId]);
      expect(rows[0]).toMatchObject({ assessment_id: assessmentId, version: 1, is_current: true, format: "json" });
    });
  });

  describe("open_assessment_revision RPC and version preservation", () => {
    it("refuses a non-admin", async () => {
      const { assessmentId } = await approve("2026-EP-IN-GOV-REV1");
      const assessorId = await createUser("assessor");
      await expect(
        asUser(pool, assessorId, (client) => client.query("select public.open_assessment_revision($1, 'Client requested a fix.')", [assessmentId])),
      ).rejects.toThrow(/only an admin may open/);
    });

    it("refuses an empty reason", async () => {
      const { assessmentId } = await approve("2026-EP-IN-GOV-REV2");
      await expect(asUser(pool, adminId, (client) => client.query("select public.open_assessment_revision($1, '   ')", [assessmentId]))).rejects.toThrow(
        /a revision needs a reason/,
      );
    });

    it("refuses to revise an assessment that isn't approved", async () => {
      const { assessmentId } = await createAssessment("2026-EP-IN-GOV-REV3");
      await expect(
        asUser(pool, adminId, (client) => client.query("select public.open_assessment_revision($1, 'Client requested a fix.')", [assessmentId])),
      ).rejects.toThrow(/is not approved/);
    });

    it("unlocks every item, resets QA/approval state, and increments revision_number", async () => {
      const { assessmentId, itemId } = await approve("2026-EP-IN-GOV-REV4");

      await asUser(pool, adminId, (client) => client.query("select public.open_assessment_revision($1, 'Client requested a fix.')", [assessmentId]));

      const assessmentRow = await pool.query(
        "select approval_status, qa_status, approved_at, qa_completed_at, revision_number from public.assessments where id = $1",
        [assessmentId],
      );
      expect(assessmentRow.rows[0]).toMatchObject({ approval_status: "pending", qa_status: "not_started", approved_at: null, qa_completed_at: null, revision_number: 2 });

      const itemRow = await pool.query("select locked from public.assessment_items where id = $1", [itemId]);
      expect(itemRow.rows[0]!.locked).toBe(false);
    });

    it("the item can be edited again once unlocked by a revision", async () => {
      const { assessmentId, itemId } = await approve("2026-EP-IN-GOV-REV5");
      await asUser(pool, adminId, (client) => client.query("select public.open_assessment_revision($1, 'Client requested a fix.')", [assessmentId]));

      await pool.query("update public.assessment_items set remarks = 'Updated after revision.' where id = $1", [itemId]);
      const { rows } = await pool.query("select remarks from public.assessment_items where id = $1", [itemId]);
      expect(rows[0]!.remarks).toBe("Updated after revision.");
    });

    it("records the revision with the preserved report id, and leaves that report row completely unchanged", async () => {
      const { assessmentId, reportId } = await approve("2026-EP-IN-GOV-REV6");
      const before = await pool.query("select * from public.reports where id = $1", [reportId]);

      await asUser(pool, adminId, (client) => client.query("select public.open_assessment_revision($1, 'Client requested a fix.')", [assessmentId]));

      const revisionRow = await pool.query("select revision_number, reason, preserved_report_id, revised_by from public.assessment_revisions where assessment_id = $1", [
        assessmentId,
      ]);
      expect(revisionRow.rows[0]).toMatchObject({ revision_number: 2, reason: "Client requested a fix.", preserved_report_id: reportId, revised_by: adminId });

      const after = await pool.query("select * from public.reports where id = $1", [reportId]);
      expect(after.rows[0]).toEqual(before.rows[0]);
    });

    it("a second approval creates version 2, flips version 1's is_current false, and never touches version 1's own data", async () => {
      const { assessmentId, itemId, reportId: reportV1 } = await approve("2026-EP-IN-GOV-REV7");
      const v1Before = await pool.query("select * from public.reports where id = $1", [reportV1]);

      await asUser(pool, adminId, (client) => client.query("select public.open_assessment_revision($1, 'Client requested a fix.')", [assessmentId]));
      await pool.query("update public.assessment_items set remarks = 'Revised remark.' where id = $1", [itemId]);
      await pool.query("update public.assessments set qa_status = 'passed' where id = $1", [assessmentId]);

      const approveResult = await asUser(pool, adminId, (client) =>
        client.query<{ approve_assessment_and_generate_report: string }>(
          "select public.approve_assessment_and_generate_report($1, $2, $3::jsonb, 'json', $4, 'Low', 100, 100) as approve_assessment_and_generate_report",
          [assessmentId, `${assessmentId}/v2.json`, JSON.stringify({ header: {}, rows: [{ remarks: "Revised remark." }] }), scoringWeightsId],
        ),
      );
      const reportV2 = approveResult.rows[0]!.approve_assessment_and_generate_report;

      const v2Row = await pool.query("select version, is_current from public.reports where id = $1", [reportV2]);
      expect(v2Row.rows[0]).toMatchObject({ version: 2, is_current: true });

      const v1After = await pool.query("select * from public.reports where id = $1", [reportV1]);
      expect(v1After.rows[0]!.is_current).toBe(false);
      // Every other column — version, storage_path, snapshot, format, generated_at, generated_by — is untouched.
      expect({ ...v1After.rows[0], is_current: undefined }).toEqual({ ...v1Before.rows[0], is_current: undefined });
    });
  });
});
