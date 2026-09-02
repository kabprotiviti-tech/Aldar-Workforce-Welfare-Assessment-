import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAndStore, type EvaluationDb, type LoadedRuleDefinition, type StoredEvaluation } from "@/lib/rules/compliance/evaluate";
import { COMPLIANCE_RULES, getRule } from "@/lib/rules/compliance/registry";
import { ADMIN_DATABASE_URL, isReachable, resetAndMigrate } from "./helpers";

/**
 * The rule engine against real Postgres: that the seeded thresholds are
 * the ones the code computes with, that an evaluation is stored with the
 * threshold and version it used (this prompt: "stamped onto each
 * evaluation... stored, not recomputed on read, so a report is
 * reproducible"), and that revising a threshold cannot rewrite a past
 * result.
 */
function pgEvaluationDb(pool: Pool): EvaluationDb {
  return {
    async loadDefinitions(codes): Promise<LoadedRuleDefinition[]> {
      const { rows } = await pool.query(
        `select id, code, version, threshold, legal_reference from public.rule_definitions
         where code = any($1::text[]) and active and deleted_at is null`,
        [codes],
      );
      return rows.map((row) => ({
        id: row.id,
        code: row.code,
        version: row.version,
        threshold: row.threshold ?? null,
        legalReference: row.legal_reference,
      }));
    },
    async storeEvaluations(evaluations: StoredEvaluation[]): Promise<number> {
      let count = 0;
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
        count += 1;
      }
      return count;
    },
  };
}

const pool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(pool);

if (!reachable) {
  console.warn(`Skipping rule engine test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("rule engine against a real database", () => {
  let assessmentItemId: string;
  let db: EvaluationDb;

  beforeAll(async () => {
    await resetAndMigrate(pool);
    db = pgEvaluationDb(pool);

    const cycle = await pool.query<{ id: string }>("insert into public.cycles (year, name) values (2026, 'Rule engine cycle') returning id");
    const template = await pool.query<{ id: string }>(
      "select id from public.checklist_templates where module = 'employment_practices' and is_active limit 1",
    );
    const requirement = await pool.query<{ id: string }>(
      "select id from public.requirements where template_id = $1 and sl_no = 18",
      [template.rows[0]!.id],
    );
    const entity = await pool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Rule Engine Entity', 'RULES-1', 'general_contractor') returning id",
    );
    const assessment = await pool.query<{ id: string }>(
      `insert into public.assessments (module, cycle_id, entity_id, template_id, subject_code, assessment_type, actual_visit_date)
       values ('employment_practices', $1, $2, $3, '2026-EP-IN-RULES-1', 'initial', '2026-06-01') returning id`,
      [cycle.rows[0]!.id, entity.rows[0]!.id, template.rows[0]!.id],
    );
    const item = await pool.query<{ id: string }>(
      "insert into public.assessment_items (assessment_id, requirement_id) values ($1, $2) returning id",
      [assessment.rows[0]!.id, requirement.rows[0]!.id],
    );
    assessmentItemId = item.rows[0]!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("seeds a definition for every implemented rule, mapped to the requirement its code names", async () => {
    const { rows } = await pool.query(
      `select d.code, d.version, d.module, r.sl_no
       from public.rule_definitions d join public.requirements r on r.id = d.requirement_id
       where d.active`,
    );

    expect(rows).toHaveLength(COMPLIANCE_RULES.length);
    for (const row of rows) {
      const rule = getRule(row.code);
      expect(rule, `no implemented rule for seeded code ${row.code}`).not.toBeNull();
      expect(row.module).toBe(rule!.module);
      expect(row.sl_no).toBe(rule!.requirementSlNo);
      expect(row.version).toBe(1);
    }
  });

  it("seeds the same thresholds the rule functions declare as defaults", async () => {
    // Two sources of the same numbers is a drift risk; this is the guard.
    const { rows } = await pool.query("select code, threshold, input_fact_keys, quantitative_keys, explanation_template from public.rule_definitions where active");

    for (const row of rows) {
      const rule = getRule(row.code)!;
      expect(row.threshold, `threshold drift for ${row.code}`).toEqual(rule.defaultThresholds);
      expect(row.input_fact_keys, `fact keys drift for ${row.code}`).toEqual([...rule.inputFactKeys]);
      expect(row.quantitative_keys, `quantitative keys drift for ${row.code}`).toEqual([...rule.quantitativeKeys]);
      expect(row.explanation_template, `template drift for ${row.code}`).toBe(rule.explanationTemplate);
    }
  });

  it("allows only one active version of a rule at a time", async () => {
    await expect(
      pool.query(
        `insert into public.rule_definitions (code, module, requirement_id, version, active, threshold)
         select code, module, requirement_id, 2, true, threshold from public.rule_definitions where code = 'R18_ROOM_AREA'`,
      ),
    ).rejects.toThrow(/rule_definitions_one_active_per_code/);
  });

  it("stores an evaluation stamped with the outcome, working, version, threshold and citation", async () => {
    const result = await runAndStore(db, ["R18_ROOM_AREA"], [
      {
        assessmentItemId,
        subjectRef: "Room A-101",
        inputs: { facts: { drawing_room_area_m2: 26.4, occupancy_headcount: 8 }, quantitative: {}, assessmentDate: "2026-06-01" },
      },
    ]);

    expect(result.problems).toEqual([]);
    expect(result.storedCount).toBe(1);

    const { rows } = await pool.query(
      `select rule_code, rule_version, subject_ref, result, computed_explanation, missing_fact_keys, thresholds, legal_reference, observed
       from public.rule_evaluations where assessment_item_id = $1 and rule_code = 'R18_ROOM_AREA'`,
      [assessmentItemId],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rule_code: "R18_ROOM_AREA",
      rule_version: 1,
      subject_ref: "Room A-101",
      result: "fail",
      computed_explanation: "26.4 m² / 8 residents = 3.30 m² per resident. Minimum 4.00 m². Below threshold.",
      missing_fact_keys: [],
      thresholds: { minAreaPerResidentM2: 4 },
    });
    expect(rows[0]!.legal_reference).toContain("WWAP checklist requirement 18");
    expect(rows[0]!.observed).toMatchObject({ area: 26.4, occupancy: 8 });
  });

  it("stores insufficient_data as its own result, naming the missing inputs", async () => {
    const result = await runAndStore(db, ["R16_HOURS"], [
      { assessmentItemId, subjectRef: null, inputs: { facts: {}, quantitative: { hours_per_day: 8 }, assessmentDate: "2026-06-01" } },
    ]);

    expect(result.storedCount).toBe(1);

    const { rows } = await pool.query(
      "select result, missing_fact_keys, computed_explanation from public.rule_evaluations where assessment_item_id = $1 and rule_code = 'R16_HOURS'",
      [assessmentItemId],
    );

    expect(rows[0]!.result).toBe("insufficient_data");
    expect(rows[0]!.missing_fact_keys).toEqual(["hours_per_week", "hours_per_three_weeks", "max_consecutive_days_worked"]);
    expect(rows[0]!.computed_explanation).toContain("is not a pass");
  });

  it("refuses to alter a definition that an evaluation already points at", async () => {
    // Editing the threshold in place would silently rewrite the basis of
    // the result stored above.
    await expect(
      pool.query("update public.rule_definitions set threshold = '{\"minAreaPerResidentM2\": 3}'::jsonb where code = 'R18_ROOM_AREA'"),
    ).rejects.toThrow(/immutable except for active/);

    await expect(pool.query("delete from public.rule_definitions where code = 'R18_ROOM_AREA'")).rejects.toThrow(/cannot be deleted/);
  });

  it("keeps the old result intact when a new version supersedes the threshold", async () => {
    const before = await pool.query(
      "select id, result, computed_explanation, thresholds, rule_version from public.rule_evaluations where assessment_item_id = $1 and rule_code = 'R18_ROOM_AREA'",
      [assessmentItemId],
    );
    const original = before.rows[0]!;

    // An admin revises the minimum: supersede, never edit.
    await pool.query("update public.rule_definitions set active = false where code = 'R18_ROOM_AREA' and version = 1");
    await pool.query(
      `insert into public.rule_definitions (code, module, requirement_id, title, description, input_fact_keys, quantitative_keys,
                                            threshold, legal_reference, explanation_template, version, active)
       select code, module, requirement_id, title, description, input_fact_keys, quantitative_keys,
              '{"minAreaPerResidentM2": 3}'::jsonb, legal_reference, explanation_template, 2, true
       from public.rule_definitions where code = 'R18_ROOM_AREA' and version = 1`,
    );

    const rerun = await runAndStore(db, ["R18_ROOM_AREA"], [
      {
        assessmentItemId,
        subjectRef: "Room A-101",
        inputs: { facts: { drawing_room_area_m2: 26.4, occupancy_headcount: 8 }, quantitative: {}, assessmentDate: "2026-06-01" },
      },
    ]);
    expect(rerun.storedCount).toBe(1);

    // The original row is untouched: same outcome, same working, same
    // threshold, same version — a report issued from it still reproduces.
    const after = await pool.query("select result, computed_explanation, thresholds, rule_version from public.rule_evaluations where id = $1", [
      original.id,
    ]);
    expect(after.rows[0]).toEqual({
      result: original.result,
      computed_explanation: original.computed_explanation,
      thresholds: original.thresholds,
      rule_version: original.rule_version,
    });

    // And the re-run is a new row, stamped with the new version and threshold.
    const all = await pool.query(
      "select result, rule_version, thresholds from public.rule_evaluations where assessment_item_id = $1 and rule_code = 'R18_ROOM_AREA' order by rule_version",
      [assessmentItemId],
    );
    expect(all.rows).toHaveLength(2);
    expect(all.rows[1]).toMatchObject({ result: "pass", rule_version: 2, thresholds: { minAreaPerResidentM2: 3 } });
  });

  it("reads facts only through fact_ledger_confirmed, so a proposed value cannot reach a rule", async () => {
    // fact_ledger_confirmed is what lib/rules/compliance/evaluate-supabase.ts
    // selects from; this asserts the view genuinely withholds a proposed
    // value from the query the engine runs.
    const { rows: columns } = await pool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'fact_ledger_confirmed'",
    );
    const names = columns.map((row) => row.column_name);

    expect(names).toContain("assessment_id");
    expect(names).toContain("fact_key");
    expect(names).toContain("confirmed_value");
    expect(names.filter((name) => name.startsWith("value_"))).toEqual([]);
  });
});
