import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isVisibleInWorkspace, WORKSPACE_OBSERVATION_STATUS } from "@/lib/observations/store";
import { ADMIN_DATABASE_URL, asUser, authenticatedDatabaseUrl, isReachable, resetAndMigrate } from "./helpers";

/**
 * Acceptance criterion (this prompt): "Confirmed observations appear in
 * the assessor workspace for that requirement. Rejected ones do not."
 *
 * Proven against the real query the workspace runs, on real rows, plus
 * the retention half — a rejected observation is kept, with its reason,
 * rather than deleted.
 */
const WORKSPACE_QUERY = `
  select o.id, o.kind, o.title, o.status, o.rejection_reason, o.authored_by
  from public.ai_observations o
  where o.assessment_item_id = $1 and o.status = $2
  order by o.created_at
`;

const pool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(pool);

if (!reachable) {
  console.warn(`Skipping observations test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("observations against a real database", () => {
  /**
   * RLS assertions need a connection as the `authenticated` role: the
   * admin pool is the table owner and bypasses row-level security
   * entirely, so an insert through it proves nothing about the policy.
   */
  let authenticatedPool: Pool;
  let assessorId: string;
  let viewerId: string;
  let itemId: string;
  let otherItemId: string;
  let requirementId: string;

  async function insertObservation(overrides: {
    itemId?: string;
    kind: string;
    title: string;
    status: string;
    rejectionReason?: string | null;
    authoredBy?: string;
    sourceFactKeys?: string[];
  }): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `insert into public.ai_observations
         (assessment_item_id, requirement_id, kind, title, body, status, rejection_reason, authored_by, source_fact_keys, rule_code)
       values ($1, $2, $3, $4, 'narrative body', $5, $6, $7, $8, 'R11_WAGE_DATE')
       returning id`,
      [
        overrides.itemId ?? itemId,
        requirementId,
        overrides.kind,
        overrides.title,
        overrides.status,
        overrides.rejectionReason ?? null,
        overrides.authoredBy ?? "model",
        overrides.sourceFactKeys ?? ["wps_transfer_date"],
      ],
    );
    return result.rows[0]!.id;
  }

  beforeAll(async () => {
    await resetAndMigrate(pool);
    authenticatedPool = new Pool({ connectionString: authenticatedDatabaseUrl() });

    const assessor = await pool.query<{ id: string }>("insert into auth.users default values returning id");
    assessorId = assessor.rows[0]!.id;
    await pool.query("insert into public.users (id, full_name, role, active) values ($1, 'Test assessor', 'assessor', true)", [assessorId]);

    const viewer = await pool.query<{ id: string }>("insert into auth.users default values returning id");
    viewerId = viewer.rows[0]!.id;
    await pool.query("insert into public.users (id, full_name, role, active) values ($1, 'Test viewer', 'client_viewer', true)", [viewerId]);

    const cycle = await pool.query<{ id: string }>("insert into public.cycles (year, name) values (2026, 'Observations cycle') returning id");
    const template = await pool.query<{ id: string }>(
      "select id from public.checklist_templates where module = 'employment_practices' and is_active limit 1",
    );
    const requirement = await pool.query<{ id: string }>("select id from public.requirements where template_id = $1 and sl_no = 11", [
      template.rows[0]!.id,
    ]);
    requirementId = requirement.rows[0]!.id;
    const otherRequirement = await pool.query<{ id: string }>("select id from public.requirements where template_id = $1 and sl_no = 12", [
      template.rows[0]!.id,
    ]);

    const entity = await pool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Observations Entity', 'OBS-1', 'general_contractor') returning id",
    );
    const assessment = await pool.query<{ id: string }>(
      `insert into public.assessments (module, cycle_id, entity_id, template_id, subject_code, assessment_type)
       values ('employment_practices', $1, $2, $3, '2026-EP-IN-OBS-1', 'initial') returning id`,
      [cycle.rows[0]!.id, entity.rows[0]!.id, template.rows[0]!.id],
    );
    const item = await pool.query<{ id: string }>(
      "insert into public.assessment_items (assessment_id, requirement_id) values ($1, $2) returning id",
      [assessment.rows[0]!.id, requirementId],
    );
    itemId = item.rows[0]!.id;

    const other = await pool.query<{ id: string }>(
      "insert into public.assessment_items (assessment_id, requirement_id) values ($1, $2) returning id",
      [assessment.rows[0]!.id, otherRequirement.rows[0]!.id],
    );
    otherItemId = other.rows[0]!.id;
  });

  afterAll(async () => {
    await authenticatedPool.end();
    await pool.end();
  });

  it("shows a confirmed observation in the workspace for its requirement", async () => {
    const confirmed = await insertObservation({ kind: "evidence_identified", title: "WPS file covers all 120 workers", status: "confirmed" });

    const { rows } = await pool.query(WORKSPACE_QUERY, [itemId, WORKSPACE_OBSERVATION_STATUS]);

    expect(rows.map((row) => row.id)).toContain(confirmed);
  });

  it("does not show a rejected observation, and does not show an unreviewed one either", async () => {
    const rejected = await insertObservation({
      kind: "requires_attention",
      title: "Transfer appears late",
      status: "rejected",
      rejectionReason: "Read the wrong column; the transfer was on the 14th.",
    });
    const open = await insertObservation({ kind: "potential_gap", title: "Divisions not evidenced", status: "open" });

    const { rows } = await pool.query(WORKSPACE_QUERY, [itemId, WORKSPACE_OBSERVATION_STATUS]);
    const visible = rows.map((row) => row.id);

    expect(visible).not.toContain(rejected);
    expect(visible).not.toContain(open);
  });

  it("retains a rejected observation with its reason rather than deleting it", async () => {
    const rejected = await insertObservation({
      kind: "requires_attention",
      title: "Deduction flagged in error",
      status: "rejected",
      rejectionReason: "Accommodation deduction is contractual and agreed.",
    });

    const { rows } = await pool.query("select status, rejection_reason, title from public.ai_observations where id = $1", [rejected]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "rejected",
      rejection_reason: "Accommodation deduction is contractual and agreed.",
      title: "Deduction flagged in error",
    });
  });

  it("scopes the workspace query to one requirement's own item", async () => {
    const onOtherRequirement = await insertObservation({
      itemId: otherItemId,
      kind: "evidence_identified",
      title: "Deductions all contractual",
      status: "confirmed",
    });

    const { rows } = await pool.query(WORKSPACE_QUERY, [itemId, WORKSPACE_OBSERVATION_STATUS]);

    expect(rows.map((row) => row.id)).not.toContain(onOtherRequirement);
  });

  it("shows an assessor's own observation alongside the model's", async () => {
    const mine = await insertObservation({
      kind: "requires_attention",
      title: "Night-shift roster not produced during the visit",
      status: "confirmed",
      authoredBy: "assessor",
    });

    const { rows } = await pool.query(WORKSPACE_QUERY, [itemId, WORKSPACE_OBSERVATION_STATUS]);
    const row = rows.find((entry) => entry.id === mine);

    expect(row).toBeDefined();
    expect(row!.authored_by).toBe("assessor");
  });

  it("accepts only the three permitted kinds", async () => {
    await expect(insertObservation({ kind: "compliance_status", title: "Not compliant", status: "open" })).rejects.toThrow(
      /ai_observations_kind_check/,
    );
    await expect(insertObservation({ kind: "recommendation", title: "Suggest a fix", status: "open" })).rejects.toThrow(
      /ai_observations_kind_check/,
    );
  });

  it("has no column an observation could carry a compliance status in", async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'ai_observations'",
    );
    const names = rows.map((row) => row.column_name);

    // `status` here is the review state (open/confirmed/rejected/noted),
    // constrained by its own check — not a compliance rating.
    expect(names).not.toContain("compliance_status");
    expect(names).not.toContain("rating");
    expect(names).not.toContain("score");

    const { rows: constraint } = await pool.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
       where conrelid = 'public.ai_observations'::regclass and conname = 'ai_observations_status_check'`,
    );
    expect(constraint[0]!.definition).toContain("'open'");
    expect(constraint[0]!.definition).not.toContain("compliant");
  });

  it("lets an assessor add their own observation through RLS, and refuses a client_viewer", async () => {
    const inserted = await asUser(authenticatedPool, assessorId, (client) =>
      client.query<{ id: string }>(
        `insert into public.ai_observations (assessment_item_id, requirement_id, kind, title, status, authored_by, created_by)
         values ($1, $2, 'requires_attention', 'Added by the assessor', 'confirmed', 'assessor', $3) returning id`,
        [itemId, requirementId, assessorId],
      ),
    );
    expect(inserted.rows[0]!.id).toBeTruthy();

    await expect(
      asUser(authenticatedPool, viewerId, (client) =>
        client.query(
          `insert into public.ai_observations (assessment_item_id, requirement_id, kind, title, status, authored_by)
           values ($1, $2, 'requires_attention', 'Added by a client viewer', 'confirmed', 'assessor')`,
          [itemId, requirementId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("agrees with the workspace visibility helper the UI uses", () => {
    expect(isVisibleInWorkspace("confirmed")).toBe(true);
    expect(isVisibleInWorkspace("rejected")).toBe(false);
    expect(isVisibleInWorkspace("open")).toBe(false);
    expect(isVisibleInWorkspace("noted")).toBe(false);
  });
});
