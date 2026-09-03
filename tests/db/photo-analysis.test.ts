import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAndStore, type EvaluationDb, type LoadedRuleDefinition, type StoredEvaluation } from "@/lib/rules/compliance/evaluate";
import { PHOTO_CLASSES } from "@/lib/vision/classes";
import { PHOTO_DERIVED_FACT_KEYS } from "@/lib/vision/derived-facts";
import { ADMIN_DATABASE_URL, asUser, authenticatedDatabaseUrl, isReachable, resetAndMigrate } from "./helpers";

/**
 * Acceptance criteria (this prompt):
 * - "Rejected analyses are retained with reason and excluded from the
 *   report."
 * - "A photo-derived date becomes a fact only after assessor
 *   confirmation, then feeds the rule engine like any other fact."
 *
 * The other criterion — a bedroom photograph never yielding an area or
 * per-person value — is proven in lib/vision/analyse.test.ts against the
 * analyser, and here against the database, which refuses such a fact
 * even to a superuser connection.
 */
function pgEvaluationDb(pool: Pool): EvaluationDb {
  return {
    async loadDefinitions(codes): Promise<LoadedRuleDefinition[]> {
      const { rows } = await pool.query(
        `select id, code, version, threshold, legal_reference from public.rule_definitions
         where code = any($1::text[]) and active and deleted_at is null`,
        [codes],
      );
      return rows.map((row) => ({ id: row.id, code: row.code, version: row.version, threshold: row.threshold ?? null, legalReference: row.legal_reference }));
    },
    async storeEvaluations(evaluations: StoredEvaluation[]): Promise<number> {
      for (const evaluation of evaluations) {
        await pool.query(
          `insert into public.rule_evaluations
             (assessment_item_id, subject_ref, rule_code, rule_definition_id, rule_version, result,
              computed_explanation, missing_fact_keys, inputs, observed, thresholds, legal_reference)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            evaluation.assessmentItemId,
            evaluation.subjectRef,
            evaluation.ruleCode,
            evaluation.ruleDefinitionId,
            evaluation.ruleVersion,
            evaluation.outcome,
            evaluation.computedExplanation,
            evaluation.missingFactKeys,
            JSON.stringify(evaluation.inputs),
            JSON.stringify(evaluation.observed),
            JSON.stringify(evaluation.thresholds),
            evaluation.legalReference,
          ],
        );
      }
      return evaluations.length;
    },
  };
}

const pool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(pool);

if (!reachable) {
  console.warn(`Skipping photo analysis test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("photograph analysis against a real database", () => {
  let authenticatedPool: Pool;
  let assessorId: string;
  let viewerId: string;
  let assessmentId: string;
  let itemId: string;
  let requirementId: string;

  /** One photograph and one proposed analysis of it, ready to be reviewed. */
  async function seedAnalysis(
    photoClass: string,
    findings: unknown[],
    cannotDetermine: string[] = ["Floor area of the room — a photograph cannot measure it."],
  ): Promise<{ photoId: string; analysisId: string }> {
    const photo = await pool.query<{ id: string }>(
      `insert into public.photos (assessment_id, requirement_id, room_ref, photo_class, storage_path, captured_at, uploaded_by)
       values ($1, $2, 'A-101', $3, $4, now(), $5) returning id`,
      [assessmentId, requirementId, photoClass, `inspection/${assessmentId}/${randomUUID()}.jpg`, assessorId],
    );
    const analysis = await pool.query<{ id: string }>(
      `insert into public.photo_analyses (photo_id, photo_class, model, prompt_version, findings, cannot_determine)
       values ($1, $2, 'claude-test', 'photo.v1', $3::jsonb, $4::text[]) returning id`,
      [photo.rows[0]!.id, photoClass, JSON.stringify(findings), cannotDetermine],
    );
    return { photoId: photo.rows[0]!.id, analysisId: analysis.rows[0]!.id };
  }

  async function resolveAs(
    userId: string,
    analysisId: string,
    status: string,
    editedFindings: unknown,
    rejectionReason: string | null,
    derivedFacts: unknown[],
  ): Promise<void> {
    await asUser(authenticatedPool, userId, (client) =>
      client.query("select public.resolve_photo_analysis($1, $2, $3::jsonb, $4, $5::jsonb)", [
        analysisId,
        status,
        editedFindings === null ? null : JSON.stringify(editedFindings),
        rejectionReason,
        JSON.stringify(derivedFacts),
      ]),
    );
  }

  beforeAll(async () => {
    await resetAndMigrate(pool);
    authenticatedPool = new Pool({ connectionString: authenticatedDatabaseUrl() });

    const assessor = await pool.query<{ id: string }>("insert into auth.users default values returning id");
    assessorId = assessor.rows[0]!.id;
    await pool.query("insert into public.users (id, full_name, role, active) values ($1, 'Site assessor', 'assessor', true)", [assessorId]);

    const viewer = await pool.query<{ id: string }>("insert into auth.users default values returning id");
    viewerId = viewer.rows[0]!.id;
    await pool.query("insert into public.users (id, full_name, role, active) values ($1, 'Client viewer', 'client_viewer', true)", [viewerId]);

    const cycle = await pool.query<{ id: string }>("insert into public.cycles (year, name) values (2026, 'Photo cycle') returning id");
    const template = await pool.query<{ id: string }>(
      "select id from public.checklist_templates where module = 'accommodation' and is_active limit 1",
    );
    const entity = await pool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Photo Entity', 'PH-1', 'general_contractor') returning id",
    );
    const facility = await pool.query<{ id: string }>(
      "insert into public.facilities (entity_id, facility_code, name) values ($1, 'PH-1-F1', 'Photo Accommodation') returning id",
      [entity.rows[0]!.id],
    );

    const requirement = await pool.query<{ id: string }>(
      "select id from public.requirements where template_id = $1 and sl_no = 2 and deleted_at is null",
      [template.rows[0]!.id],
    );
    requirementId = requirement.rows[0]!.id;

    const assessment = await pool.query<{ id: string }>(
      `insert into public.assessments (module, cycle_id, entity_id, facility_id, template_id, subject_code, assessment_type, actual_visit_date)
       values ('accommodation', $1, $2, $3, $4, '2026-ACM-IN-PH-1', 'initial', '2026-06-01') returning id`,
      [cycle.rows[0]!.id, entity.rows[0]!.id, facility.rows[0]!.id, template.rows[0]!.id],
    );
    assessmentId = assessment.rows[0]!.id;

    const item = await pool.query<{ id: string }>(
      "insert into public.assessment_items (assessment_id, requirement_id) values ($1, $2) returning id",
      [assessmentId, requirementId],
    );
    itemId = item.rows[0]!.id;
  });

  afterAll(async () => {
    await authenticatedPool.end();
    await pool.end();
  });

  it("keeps a rejected analysis, with its reason, and excludes it from the confirmed read path", async () => {
    const { analysisId } = await seedAnalysis("room_general", [{ field: "waste_visible", observed: "present" }]);

    await resolveAs(assessorId, analysisId, "rejected", null, "  Photograph is of the corridor, not the room.  ", []);

    // Retained.
    const { rows } = await pool.query(
      "select status, rejection_reason, findings, reviewed_by from public.photo_analyses where id = $1",
      [analysisId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("rejected");
    expect(rows[0]!.rejection_reason).toBe("Photograph is of the corridor, not the room.");
    expect(rows[0]!.reviewed_by).toBe(assessorId);
    // The model's readings are not wiped: the rejection is a judgement
    // about them, and deleting the thing judged makes the judgement
    // unauditable.
    expect(rows[0]!.findings).toHaveLength(1);

    // Excluded.
    const view = await pool.query("select id from public.photo_analysis_confirmed where id = $1", [analysisId]);
    expect(view.rowCount).toBe(0);
  });

  it("refuses to let a rejected analysis produce a fact", async () => {
    const { analysisId } = await seedAnalysis("fire_extinguisher", [{ field: "service_date_text", observed: "present" }]);

    await expect(
      resolveAs(assessorId, analysisId, "rejected", null, "Wrong unit.", [
        { fact_key: "fire_extinguisher_service_date", value_date: "2025-03-12", verbatim_quote: "12/03/2025", confidence: "high" },
      ]),
    ).rejects.toThrow(/cannot produce facts/i);

    const analysis = await pool.query("select status from public.photo_analyses where id = $1", [analysisId]);
    expect(analysis.rows[0]!.status).toBe("proposed");
    const facts = await pool.query("select id from public.extracted_facts where photo_analysis_id = $1", [analysisId]);
    expect(facts.rowCount).toBe(0);
  });

  it("requires a reason on a rejection", async () => {
    const { analysisId } = await seedAnalysis("vehicle", []);
    await expect(resolveAs(assessorId, analysisId, "rejected", null, "   ", [])).rejects.toThrow(/rejection needs a reason/i);
  });

  it("will not let a second person re-decide an analysis someone has already reviewed", async () => {
    const { analysisId } = await seedAnalysis("exit_route", []);
    await resolveAs(assessorId, analysisId, "accepted", null, null, []);
    await expect(resolveAs(assessorId, analysisId, "rejected", null, "Changed my mind.", [])).rejects.toThrow(/already been resolved/i);
  });

  it("turns a confirmed reading into a fact that the rule engine then reads like any other", async () => {
    const { analysisId } = await seedAnalysis(
      "certificate_document",
      [{ field: "expiry_date_text", observed: "present", verbatimText: "Valid to 31-12-2026" }],
      ["Whether the document is genuine, current, or has been superseded."],
    );

    // Nothing yet: an analysis on its own is not a fact.
    const before = await pool.query("select id from public.fact_ledger_confirmed where assessment_id = $1", [assessmentId]);
    expect(before.rowCount).toBe(0);

    await resolveAs(assessorId, analysisId, "accepted", null, null, [
      {
        fact_key: "civil_defence_expiry_date",
        value_text: null,
        value_date: "2026-12-31",
        unit: null,
        verbatim_quote: "Valid to 31-12-2026",
        confidence: "high",
      },
    ]);

    const fact = await pool.query(
      "select fact_key, confirmed_value, status, resolved_by, photo_id from public.fact_ledger_confirmed where assessment_id = $1",
      [assessmentId],
    );
    expect(fact.rows).toHaveLength(1);
    expect(fact.rows[0]!.fact_key).toBe("civil_defence_expiry_date");
    expect(fact.rows[0]!.confirmed_value).toBe("2026-12-31");
    expect(fact.rows[0]!.status).toBe("accepted");
    expect(fact.rows[0]!.resolved_by).toBe(assessorId);
    expect(fact.rows[0]!.photo_id).toBeTruthy();

    // "Feeds the rule engine like any other fact": R18_CD_CERT reads
    // civil_defence_expiry_date and cannot tell where it came from.
    const result = await runAndStore(pgEvaluationDb(pool), ["R18_CD_CERT"], [
      {
        assessmentItemId: itemId,
        subjectRef: null,
        inputs: {
          // Read back out of the confirmed view, not handed in: this is
          // the fact the assessor's photograph decision created.
          facts: { civil_defence_expiry_date: fact.rows[0]!.confirmed_value as string },
          quantitative: {},
          assessmentDate: "2026-06-01",
        },
      },
    ]);
    expect(result.problems).toEqual([]);
    expect(result.storedCount).toBe(1);

    const evaluation = await pool.query(
      "select result, computed_explanation from public.rule_evaluations where assessment_item_id = $1 and rule_code = 'R18_CD_CERT'",
      [itemId],
    );
    expect(evaluation.rows).toHaveLength(1);
    expect(evaluation.rows[0]!.result).toBe("pass");
    expect(evaluation.rows[0]!.computed_explanation).toContain("2026-12-31");
  });

  it("writes an audit row for the decision and for every fact it creates", async () => {
    const { analysisId } = await seedAnalysis("notice_board", [
      { field: "grievance_number_legible", observed: "present", verbatimText: "800 12345" },
    ]);

    await resolveAs(assessorId, analysisId, "accepted", null, null, [
      { fact_key: "grievance_contact_number", value_text: "800 12345", value_date: null, unit: null, verbatim_quote: "800 12345", confidence: "high" },
    ]);

    const decision = await pool.query(
      "select actor_id, action from public.audit_log where entity_type = 'photo_analysis' and entity_id = $1",
      [analysisId],
    );
    expect(decision.rows).toHaveLength(1);
    expect(decision.rows[0]!.action).toBe("photo_analysis.accept");
    expect(decision.rows[0]!.actor_id).toBe(assessorId);

    const factId = await pool.query<{ id: string }>("select id from public.extracted_facts where photo_analysis_id = $1", [analysisId]);
    const factAudit = await pool.query("select action, actor_id from public.audit_log where entity_type = 'extracted_fact' and entity_id = $1", [
      factId.rows[0]!.id,
    ]);
    expect(factAudit.rows).toHaveLength(1);
    expect(factAudit.rows[0]!.action).toBe("fact.accept");
    expect(factAudit.rows[0]!.actor_id).toBe(assessorId);
  });

  it("keeps the assessor's corrected readings on an edit, and the model's own as provenance", async () => {
    const modelReadings = [{ field: "registration_plate_text", observed: "present", verbatimText: "AUH 1Z345" }];
    const { analysisId } = await seedAnalysis("vehicle", modelReadings);
    const corrected = [{ field: "registration_plate_text", observed: "present", verbatimText: "AUH 12345" }];

    await resolveAs(assessorId, analysisId, "edited", corrected, null, [
      { fact_key: "vehicle_registration_plate", value_text: "AUH 12345", value_date: null, unit: null, verbatim_quote: "AUH 1Z345", confidence: "medium" },
    ]);

    const stored = await pool.query("select findings, edited_findings from public.photo_analyses where id = $1", [analysisId]);
    expect(stored.rows[0]!.findings).toEqual(modelReadings);
    expect(stored.rows[0]!.edited_findings).toEqual(corrected);

    const view = await pool.query("select confirmed_findings from public.photo_analysis_confirmed where id = $1", [analysisId]);
    expect(view.rows[0]!.confirmed_findings).toEqual(corrected);
  });

  it("refuses to resolve an analysis for someone who is not staff", async () => {
    const { analysisId } = await seedAnalysis("kitchen_general", []);
    await expect(resolveAs(viewerId, analysisId, "accepted", null, null, [])).rejects.toThrow(/only staff may resolve/i);
  });
});

/**
 * The database half of "a bedroom photo never yields an area or
 * per-person value". These run on the admin pool, which is the table
 * owner and a superuser: RLS does not apply to it, so if the guarantee
 * survives here it survives every code path.
 */
describe.skipIf(!reachable)("what a photograph may be recorded as", () => {
  // Its own connection: the suite above closes the module-level pool in
  // its afterAll, and these run after it.
  const guardPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  let assessmentId: string;
  let analysisId: string;

  beforeAll(async () => {
    await resetAndMigrate(guardPool);

    const assessor = await guardPool.query<{ id: string }>("insert into auth.users default values returning id");
    await guardPool.query("insert into public.users (id, full_name, role, active) values ($1, 'Assessor', 'assessor', true)", [assessor.rows[0]!.id]);

    const cycle = await guardPool.query<{ id: string }>("insert into public.cycles (year, name) values (2026, 'Guard cycle') returning id");
    const template = await guardPool.query<{ id: string }>(
      "select id from public.checklist_templates where module = 'accommodation' and is_active limit 1",
    );
    const entity = await guardPool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Guard Entity', 'GD-1', 'general_contractor') returning id",
    );
    const facility = await guardPool.query<{ id: string }>(
      "insert into public.facilities (entity_id, facility_code, name) values ($1, 'GD-1-F1', 'Guard Accommodation') returning id",
      [entity.rows[0]!.id],
    );
    const assessment = await guardPool.query<{ id: string }>(
      `insert into public.assessments (module, cycle_id, entity_id, facility_id, template_id, subject_code, assessment_type, actual_visit_date)
       values ('accommodation', $1, $2, $3, $4, '2026-ACM-IN-GD-1', 'initial', '2026-06-01') returning id`,
      [cycle.rows[0]!.id, entity.rows[0]!.id, facility.rows[0]!.id, template.rows[0]!.id],
    );
    assessmentId = assessment.rows[0]!.id;

    const photo = await guardPool.query<{ id: string }>(
      `insert into public.photos (assessment_id, room_ref, photo_class, storage_path, uploaded_by)
       values ($1, 'A-101', 'room_general', $2, $3) returning id`,
      [assessmentId, `inspection/${assessmentId}/bedroom.jpg`, assessor.rows[0]!.id],
    );
    const analysis = await guardPool.query<{ id: string }>(
      `insert into public.photo_analyses (photo_id, photo_class, model, prompt_version)
       values ($1, 'room_general', 'claude-test', 'photo.v1') returning id`,
      [photo.rows[0]!.id],
    );
    analysisId = analysis.rows[0]!.id;
  });

  afterAll(async () => {
    await guardPool.end();
  });

  it("refuses an area fact sourced from a bedroom photograph, even to a superuser", async () => {
    for (const factKey of ["drawing_room_area_m2", "room_area_m2", "floor_area_per_resident", "occupancy_headcount"]) {
      await expect(
        guardPool.query("insert into public.extracted_facts (photo_analysis_id, fact_key, value_number) values ($1, $2, 26.4)", [analysisId, factKey]),
      ).rejects.toThrow(/is not a fact key a photograph may produce/i);
    }

    const facts = await guardPool.query("select id from public.extracted_facts where photo_analysis_id = $1", [analysisId]);
    expect(facts.rowCount).toBe(0);
  });

  it("refuses an area fact key smuggled in by updating an allowed one afterwards", async () => {
    await guardPool.query(
      "insert into public.extracted_facts (photo_analysis_id, fact_key, value_text, status) values ($1, 'vehicle_registration_plate', 'AUH 12345', 'accepted')",
      [analysisId],
    );
    await expect(
      guardPool.query("update public.extracted_facts set fact_key = 'drawing_room_area_m2' where photo_analysis_id = $1", [analysisId]),
    ).rejects.toThrow(/is not a fact key a photograph may produce/i);
  });

  it("insists a fact comes from exactly one source", async () => {
    await expect(guardPool.query("insert into public.extracted_facts (fact_key, value_text) values ('grievance_contact_number', 'x')")).rejects.toThrow(
      /extracted_facts_one_source/i,
    );
  });

  it("seeds the same photograph classes and derived fact keys the code declares", async () => {
    const classes = await guardPool.query<{ photo_class: string }>("select photo_class from public.photo_class_names order by photo_class");
    expect(classes.rows.map((row) => row.photo_class)).toEqual([...PHOTO_CLASSES].sort());

    const keys = await guardPool.query<{ fact_key: string }>("select fact_key from public.photo_derived_fact_keys order by fact_key");
    expect(keys.rows.map((row) => row.fact_key)).toEqual([...PHOTO_DERIVED_FACT_KEYS]);
  });
});
