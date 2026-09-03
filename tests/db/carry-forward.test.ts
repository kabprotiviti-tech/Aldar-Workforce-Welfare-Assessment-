import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planAssessmentItems, type PreviousItemForGeneration, type RequirementForGeneration } from "@/lib/assessment/generate-items";
import { checkCarryForwardEligibility, detectRepeat, planCarryForwardDecision, previousFindingState } from "@/lib/assessment/carry-forward";
import type { ComplianceRating } from "@/lib/rules/constants";
import type { FindingStatus } from "@/lib/db/findings";
import { ADMIN_DATABASE_URL, asUser, authenticatedDatabaseUrl, isReachable, resetAndMigrate } from "./helpers";

/**
 * Carry-forward from the previous cycle, against real Postgres.
 *
 * The pure planning/eligibility logic is proven in isolation
 * (lib/assessment/carry-forward.test.ts,
 * lib/assessment/generate-items.test.ts). What only a real database can
 * prove:
 *  - Pre-populating an item with last cycle's status doesn't fight
 *    0024_assessment_decision.sql's own guarantee that a status is only
 *    ever written by an authenticated assessor deciding it — because
 *    this feature never writes compliance_status at insert time at all.
 *  - "Not assessed this cycle" goes through the exact same trigger
 *    (decided_by/decided_at stamped, audit_log written) as a genuine
 *    decision, even though the value it writes happens to equal last
 *    cycle's.
 *  - An item with an open finding really is blocked end to end, and a
 *    closed one really does unblock it.
 *  - A fresh failure against a now-closed finding is recorded as a
 *    repeat, with repeat_of_finding_id pointing at it.
 */
const pool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(pool);

if (!reachable) {
  console.warn(`Skipping carry-forward test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("carry-forward against a real database", () => {
  let authenticatedPool: Pool;
  let assessorId: string;
  let entityId: string;
  let templateId: string;
  let requirementId: string;
  let cycleId: string;

  async function createAssessment(subjectCode: string, previousAssessmentId: string | null): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `insert into public.assessments (module, cycle_id, entity_id, template_id, subject_code, assessment_type, actual_visit_date, previous_assessment_id)
       values ('employment_practices', $1, $2, $3, $4, 'initial', '2026-06-01', $5) returning id`,
      [cycleId, entityId, templateId, subjectCode, previousAssessmentId],
    );
    return result.rows[0]!.id;
  }

  /**
   * A fresh entity per test. mostRecentFinding searches the whole
   * (entity, requirement) history rather than one hop back — correctly,
   * since that's what a real repeat check needs — which means two tests
   * sharing an entity would leak an open finding from one into the
   * other. Isolating by entity keeps each test's history its own.
   */
  async function createEntity(code: string): Promise<string> {
    const result = await pool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ($1, $2, 'general_contractor') returning id",
      [code, code],
    );
    return result.rows[0]!.id;
  }

  /** The generator's logic (lib/assessment/generate-items-supabase.ts), run directly against pg — proven here as SQL, exercised there through Supabase. */
  async function generateItems(assessmentId: string, previousAssessmentId: string | null): Promise<string> {
    const requirements: RequirementForGeneration[] = [{ requirementId, slNo: 18 }];
    const previousItemsByRequirementId = new Map<string, PreviousItemForGeneration>();

    if (previousAssessmentId) {
      const { rows } = await pool.query(
        "select id, requirement_id, compliance_status, remarks, action_required from public.assessment_items where assessment_id = $1",
        [previousAssessmentId],
      );
      for (const row of rows) {
        previousItemsByRequirementId.set(row.requirement_id, {
          itemId: row.id,
          complianceStatus: row.compliance_status,
          remarks: row.remarks,
          actionRequired: row.action_required,
        });
      }
    }

    const plan = planAssessmentItems(requirements, previousItemsByRequirementId);
    const row = plan[0]!;
    const inserted = await pool.query<{ id: string }>(
      `insert into public.assessment_items
         (assessment_id, requirement_id, was_assessed, previous_compliance_status, previous_remarks, previous_action_required, carried_forward_from_item_id)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [assessmentId, requirementId, row.wasAssessed, row.snapshot.previousComplianceStatus, row.snapshot.previousRemarks, row.snapshot.previousActionRequired, row.snapshot.carriedForwardFromItemId],
    );
    return inserted.rows[0]!.id;
  }

  async function decide(itemId: string, status: ComplianceRating, remarks: string, actionRequired: string | null): Promise<void> {
    await asUser(authenticatedPool, assessorId, (client) =>
      client.query("update public.assessment_items set compliance_status = $1, remarks = $2, action_required = $3, was_assessed = true where id = $4", [
        status,
        remarks,
        actionRequired,
        itemId,
      ]),
    );
  }

  /** Mirrors lib/assessment/actions.ts's mostRecentFindingForRequirement: the whole requirement+entity history, not one hop. */
  async function mostRecentFinding(itemId: string): Promise<{ id: string; status: FindingStatus; assessmentItemId: string } | null> {
    const { rows: itemRows } = await pool.query("select requirement_id from public.assessment_items where id = $1", [itemId]);
    const requirementId = itemRows[0]!.requirement_id;
    const { rows } = await pool.query(
      `select f.id, f.status, f.assessment_item_id
       from public.findings f
       join public.assessment_items ai on ai.id = f.assessment_item_id
       where f.entity_id = $1 and ai.requirement_id = $2 and f.deleted_at is null
       order by f.created_at desc limit 1`,
      [entityId, requirementId],
    );
    return rows[0] ? { id: rows[0].id, status: rows[0].status, assessmentItemId: rows[0].assessment_item_id } : null;
  }

  /** Mirrors lib/assessment/actions.ts's recordFindingForFailingDecision, against pg directly. */
  async function recordFindingForFailingDecision(itemId: string, title: string, status: ComplianceRating): Promise<void> {
    const prior = await mostRecentFinding(itemId);
    if (prior && prior.status !== "closed" && prior.assessmentItemId === itemId) return;

    const repeat = detectRepeat(status, prior?.id ?? null, prior?.status ?? null);

    await pool.query(
      "insert into public.findings (assessment_item_id, entity_id, title, priority, status, repeat_of_finding_id, created_by) values ($1, $2, $3, 'medium', 'open', $4, $5)",
      [itemId, entityId, `${title} — ${status}`, repeat.repeatOfFindingId, assessorId],
    );
  }

  /**
   * Closes a finding the way lib/findings/actions.ts's reviewFindingClosure
   * now requires: closure evidence on record, then a reviewer decision of
   * 'accepted' — 0029_finding_lifecycle.sql's own triggers reject a bare
   * `update ... set status = 'closed'` with neither.
   */
  async function closeFinding(itemId: string, findingId: string): Promise<void> {
    const { rows } = await pool.query("select assessment_id from public.assessment_items where id = $1", [itemId]);
    await pool.query(
      "insert into public.evidence_files (assessment_id, finding_id, storage_path, original_name, mime_type, size_bytes, uploaded_by) values ($1, $2, 'closure/test.pdf', 'test.pdf', 'application/pdf', 100, $3)",
      [rows[0]!.assessment_id, findingId, assessorId],
    );
    await pool.query("update public.findings set reviewer_decision = 'accepted', reviewer_decision_by = $1, status = 'closed' where id = $2", [assessorId, findingId]);
  }

  /** Mirrors lib/assessment/actions.ts's markNotAssessedThisCycle. */
  async function markNotAssessedThisCycle(itemId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const { rows } = await pool.query("select previous_compliance_status from public.assessment_items where id = $1", [itemId]);
    const item = rows[0]!;
    const finding = await mostRecentFinding(itemId);
    const plan = planCarryForwardDecision("employment_practices", item.previous_compliance_status, previousFindingState(finding?.status ?? null));
    if (!plan.ok) return { ok: false, message: plan.message };

    await asUser(authenticatedPool, assessorId, (client) =>
      client.query("update public.assessment_items set compliance_status = $1, remarks = $2, action_required = $3, was_assessed = false where id = $4", [
        plan.decision.status,
        plan.decision.remarks,
        plan.decision.actionRequired,
        itemId,
      ]),
    );
    return { ok: true };
  }

  beforeAll(async () => {
    await resetAndMigrate(pool);
    authenticatedPool = new Pool({ connectionString: authenticatedDatabaseUrl() });

    const assessor = await pool.query<{ id: string }>("insert into auth.users default values returning id");
    assessorId = assessor.rows[0]!.id;
    await pool.query("insert into public.users (id, full_name, role, active) values ($1, 'Site assessor', 'assessor', true)", [assessorId]);

    const cycle = await pool.query<{ id: string }>("insert into public.cycles (year, name) values (2026, 'Carry-forward cycle') returning id");
    cycleId = cycle.rows[0]!.id;

    const template = await pool.query<{ id: string }>(
      "select id from public.checklist_templates where module = 'employment_practices' and is_active limit 1",
    );
    templateId = template.rows[0]!.id;

    const requirement = await pool.query<{ id: string }>(
      "select id from public.requirements where template_id = $1 and sl_no = 18 and deleted_at is null",
      [templateId],
    );
    requirementId = requirement.rows[0]!.id;

    const entity = await pool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Carry Forward Entity', 'CF-1', 'general_contractor') returning id",
    );
    entityId = entity.rows[0]!.id;
  });

  afterAll(async () => {
    await authenticatedPool.end();
    await pool.end();
  });

  it("pre-populates an item without needing an authenticated actor, since compliance_status is never set at insert", async () => {
    entityId = await createEntity(`CF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    const assessmentId = await createAssessment("2026-EP-IN-CF-1", null);
    const itemId = await generateItems(assessmentId, null);

    const { rows } = await pool.query(
      "select was_assessed, previous_compliance_status, carried_forward_from_item_id, compliance_status, decided_by from public.assessment_items where id = $1",
      [itemId],
    );
    expect(rows[0]).toMatchObject({
      was_assessed: true,
      previous_compliance_status: null,
      carried_forward_from_item_id: null,
      compliance_status: null,
      decided_by: null,
    });

    // A first-ever assessment writes no audit row for this item — nobody decided anything yet.
    const audit = await pool.query("select id from public.audit_log where entity_type = 'assessment_item' and entity_id = $1", [itemId]);
    expect(audit.rowCount).toBe(0);
  });

  it("carries the previous cycle's Partial status, remarks and open action into the new item, marked not yet assessed", async () => {
    entityId = await createEntity(`CF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    const first = await createAssessment("2026-EP-IN-CF-2", null);
    const firstItemId = await generateItems(first, null);
    await decide(firstItemId, "Partial", "Missing induction records for two workers.", "Provide induction records within 14 days.");
    await recordFindingForFailingDecision(firstItemId, "Clear inductions", "Partial");

    const second = await createAssessment("2026-EP-FU-CF-2", first);
    const secondItemId = await generateItems(second, first);

    const { rows } = await pool.query(
      "select was_assessed, previous_compliance_status, previous_remarks, previous_action_required, carried_forward_from_item_id, compliance_status from public.assessment_items where id = $1",
      [secondItemId],
    );
    expect(rows[0]).toMatchObject({
      was_assessed: false,
      previous_compliance_status: "Partial",
      previous_remarks: "Missing induction records for two workers.",
      previous_action_required: "Provide induction records within 14 days.",
      carried_forward_from_item_id: firstItemId,
      compliance_status: null,
    });
  });

  it("blocks carry-forward while the previous finding is open, with an explanatory message — this prompt's own acceptance criterion", async () => {
    entityId = await createEntity(`CF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    const first = await createAssessment("2026-EP-IN-CF-3", null);
    const firstItemId = await generateItems(first, null);
    await decide(firstItemId, "Not Compliant", "No civil defence certificate on file.", "Obtain a valid certificate.");
    await recordFindingForFailingDecision(firstItemId, "Civil defence certificate", "Not Compliant");

    const second = await createAssessment("2026-EP-FU-CF-3", first);
    const secondItemId = await generateItems(second, first);

    const result = await markNotAssessedThisCycle(secondItemId);
    expect(result).toEqual({ ok: false, message: expect.stringContaining("open finding") });

    // Blocked means blocked: nothing was written.
    const { rows } = await pool.query("select compliance_status, decided_by from public.assessment_items where id = $1", [secondItemId]);
    expect(rows[0]!.compliance_status).toBeNull();
    expect(rows[0]!.decided_by).toBeNull();
  });

  it("permits carry-forward once the previous finding is formally closed, writing the boilerplate through the same trigger as any decision", async () => {
    entityId = await createEntity(`CF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    const first = await createAssessment("2026-EP-IN-CF-4", null);
    const firstItemId = await generateItems(first, null);
    await decide(firstItemId, "Partial", "Overtime premium below the required rate for one payslip sample.", "Correct the rate and resubmit payroll.");
    await recordFindingForFailingDecision(firstItemId, "Correct overtime premium applied", "Partial");

    const finding = await mostRecentFinding(firstItemId);
    await closeFinding(firstItemId, finding!.id);

    const second = await createAssessment("2026-EP-FU-CF-4", first);
    const secondItemId = await generateItems(second, first);

    const result = await markNotAssessedThisCycle(secondItemId);
    expect(result).toEqual({ ok: true });

    const { rows } = await pool.query(
      "select compliance_status, remarks, action_required, was_assessed, decided_by, decided_at from public.assessment_items where id = $1",
      [secondItemId],
    );
    expect(rows[0]!.compliance_status).toBe("Partial");
    expect(rows[0]!.remarks).toBe(
      "This section was not assessed as part of this review. Previous monitoring has identified the policies, procedures and their application relating to this section as compliant with Aldar's Worker Welfare Policy.",
    );
    expect(rows[0]!.action_required).toBe("N/A");
    expect(rows[0]!.was_assessed).toBe(false);
    // The same guarantee as any other decision: decided_by/decided_at
    // stamped by the trigger, not by this code.
    expect(rows[0]!.decided_by).toBe(assessorId);
    expect(rows[0]!.decided_at).not.toBeNull();

    const audit = await pool.query("select action, actor_id from public.audit_log where entity_type = 'assessment_item' and entity_id = $1", [secondItemId]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.action).toBe("assessment_item.decide");
    expect(audit.rows[0]!.actor_id).toBe(assessorId);
  });

  it("permits carry-forward directly for a previously Compliant item, with no finding needed at all", async () => {
    entityId = await createEntity(`CF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    const first = await createAssessment("2026-EP-IN-CF-5", null);
    const firstItemId = await generateItems(first, null);
    await decide(firstItemId, "Compliant", "All induction records present and complete.", null);

    const second = await createAssessment("2026-EP-FU-CF-5", first);
    const secondItemId = await generateItems(second, first);

    const result = await markNotAssessedThisCycle(secondItemId);
    expect(result).toEqual({ ok: true });

    const { rows } = await pool.query("select compliance_status from public.assessment_items where id = $1", [secondItemId]);
    expect(rows[0]!.compliance_status).toBe("Compliant");
  });

  it("flags a fresh failure as a repeat when the item it carries forward from was closed, and links repeat_of_finding_id", async () => {
    entityId = await createEntity(`CF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    // Cycle 1: fails, a finding is opened.
    const first = await createAssessment("2026-EP-IN-CF-6", null);
    const firstItemId = await generateItems(first, null);
    await decide(firstItemId, "Not Compliant", "Overtime paid at the standard rate on a public holiday.", "Recalculate and repay the enhanced premium.");
    await recordFindingForFailingDecision(firstItemId, "Correct overtime premium applied", "Not Compliant");
    const originalFinding = await mostRecentFinding(firstItemId);

    // Cycle 2: the finding is closed and the item is genuinely reassessed as compliant.
    await closeFinding(firstItemId, originalFinding!.id);
    const second = await createAssessment("2026-EP-FU-CF-6", first);
    const secondItemId = await generateItems(second, first);
    await decide(secondItemId, "Compliant", "Overtime premiums now correctly applied.", null);

    // Cycle 3: it fails again.
    const third = await createAssessment("2026-EP-FU2-CF-6", second);
    const thirdItemId = await generateItems(third, second);
    await decide(thirdItemId, "Not Compliant", "The same overtime error has recurred.", "Recalculate and repay the enhanced premium.");
    await recordFindingForFailingDecision(thirdItemId, "Correct overtime premium applied", "Not Compliant");

    const repeatFinding = await mostRecentFinding(thirdItemId);
    expect(repeatFinding).not.toBeNull();
    expect(repeatFinding!.status).toBe("open");

    const { rows } = await pool.query("select repeat_of_finding_id from public.findings where id = $1", [repeatFinding!.id]);
    expect(rows[0]!.repeat_of_finding_id).toBe(originalFinding!.id);
  });

  it("does not flag a repeat when the prior finding was never closed", async () => {
    entityId = await createEntity(`CF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    const first = await createAssessment("2026-EP-IN-CF-7", null);
    const firstItemId = await generateItems(first, null);
    await decide(firstItemId, "Not Compliant", "Missing records.", "Provide records.");
    await recordFindingForFailingDecision(firstItemId, "Clear inductions", "Not Compliant");

    // Genuinely re-assessed (not carried forward — checkCarryForwardEligibility
    // would refuse this since the finding is still open) and it fails again.
    const second = await createAssessment("2026-EP-FU-CF-7", first);
    const secondItemId = await generateItems(second, first);
    await decide(secondItemId, "Not Compliant", "Still missing records.", "Provide records.");
    await recordFindingForFailingDecision(secondItemId, "Clear inductions", "Not Compliant");

    const finding = await mostRecentFinding(secondItemId);
    expect(finding!.status).toBe("open");
    const { rows } = await pool.query("select repeat_of_finding_id from public.findings where id = $1", [finding!.id]);
    expect(rows[0]!.repeat_of_finding_id).toBeNull();
  });

  it("does not duplicate a finding on a re-save of the same failing decision", async () => {
    entityId = await createEntity(`CF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    const first = await createAssessment("2026-EP-IN-CF-8", null);
    const firstItemId = await generateItems(first, null);
    await decide(firstItemId, "Partial", "First remark.", "First action.");
    await recordFindingForFailingDecision(firstItemId, "Clear inductions", "Partial");
    await decide(firstItemId, "Partial", "Edited remark.", "Edited action.");
    await recordFindingForFailingDecision(firstItemId, "Clear inductions", "Partial");

    const { rows } = await pool.query("select id from public.findings where assessment_item_id = $1", [firstItemId]);
    expect(rows).toHaveLength(1);
  });

  it("the eligibility rule matches checkCarryForwardEligibility exactly for a live open-finding case", async () => {
    entityId = await createEntity(`CF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    const first = await createAssessment("2026-EP-IN-CF-9", null);
    const firstItemId = await generateItems(first, null);
    await decide(firstItemId, "Partial", "x", "y");
    await recordFindingForFailingDecision(firstItemId, "Clear inductions", "Partial");

    const finding = await mostRecentFinding(firstItemId);
    const eligibility = checkCarryForwardEligibility("Partial", previousFindingState(finding!.status));
    expect(eligibility.eligible).toBe(false);
  });
});
