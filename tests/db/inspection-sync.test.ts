import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAndStore, type EvaluationDb, type LoadedRuleDefinition, type StoredEvaluation } from "@/lib/rules/compliance/evaluate";
import { ADMIN_DATABASE_URL, asUser, authenticatedDatabaseUrl, isReachable, resetAndMigrate } from "./helpers";

/**
 * Acceptance criteria (this prompt):
 * - "Airplane-mode test: complete a full 12-area inspection with 20
 *   photos offline, reconnect, everything syncs exactly once with no
 *   duplicates."
 * - "Quantitative fields feed the rule engine and produce evaluations
 *   after sync."
 *
 * The queue half of the airplane-mode test is proven against real
 * IndexedDB in lib/inspection/queue.test.ts. This is the server half:
 * the same 58 mutations applied through the real
 * apply_inspection_mutation function, then replayed in full, and the
 * assertion that the replay changed nothing.
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

interface Mutation {
  clientMutationId: string;
  kind: string;
  payload: Record<string, unknown>;
}

const pool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(pool);

if (!reachable) {
  console.warn(`Skipping inspection sync test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("inspection sync against a real database", () => {
  let authenticatedPool: Pool;
  let assessorId: string;
  let assessmentId: string;
  let facilityId: string;
  let areaItems: { itemId: string; slNo: number; questionId: string }[] = [];

  /** Applies one mutation the way the route handler does. */
  async function apply(mutation: Mutation): Promise<{ applied: boolean; duplicate: boolean }> {
    const { rows } = await asUser(authenticatedPool, assessorId, (client) =>
      client.query("select public.apply_inspection_mutation($1, $2, $3, $4) as outcome", [
        mutation.clientMutationId,
        assessmentId,
        mutation.kind,
        JSON.stringify(mutation.payload),
      ]),
    );
    return rows[0]!.outcome;
  }

  /** The full offline capture: 12 areas x (answer + quantitative + rating), 2 rooms, 20 photos. */
  function buildInspection(): Mutation[] {
    const mutations: Mutation[] = [];

    for (const area of areaItems) {
      mutations.push({
        clientMutationId: randomUUID(),
        kind: "area_answer",
        payload: { assessment_item_id: area.itemId, question_id: area.questionId, answer: "Yes", remark: null, action_required: null },
      });
      mutations.push({
        clientMutationId: randomUUID(),
        kind: "area_quantitative",
        // Area 3 (Bathrooms) carries the figures ACM_TOILET_RATIO reads.
        payload: {
          assessment_item_id: area.itemId,
          quantitative: area.slNo === 3 ? { residents: 96, toilets: 8, showers: 12, washbasins: 12 } : { captured: true },
        },
      });
      mutations.push({
        clientMutationId: randomUUID(),
        kind: "area_rating",
        payload: { assessment_item_id: area.itemId, compliance_status: "Compliant", remarks: null, action_required: null },
      });
    }

    for (const roomRef of ["A-101", "A-102"]) {
      mutations.push({
        clientMutationId: randomUUID(),
        kind: "room_count",
        payload: { room_ref: roomRef, bed_count: 8, occupancy_count: 8 },
      });
    }

    for (let index = 0; index < 20; index++) {
      mutations.push({
        clientMutationId: randomUUID(),
        kind: "photo",
        payload: {
          requirement_id: areaItems[index % areaItems.length]!.itemId ? null : null,
          room_ref: index % 2 === 0 ? "A-101" : "A-102",
          storage_path: `inspection/${assessmentId}/photo-${index}.jpg`,
          captured_at: new Date(Date.UTC(2026, 5, 1, 9, 0, index)).toISOString(),
          geo_lat: 24.4539,
          geo_lng: 54.3773,
          caption: `Area photo ${index}`,
        },
      });
    }

    return mutations;
  }

  beforeAll(async () => {
    await resetAndMigrate(pool);
    authenticatedPool = new Pool({ connectionString: authenticatedDatabaseUrl() });

    const assessor = await pool.query<{ id: string }>("insert into auth.users default values returning id");
    assessorId = assessor.rows[0]!.id;
    await pool.query("insert into public.users (id, full_name, role, active) values ($1, 'Site assessor', 'assessor', true)", [assessorId]);

    const cycle = await pool.query<{ id: string }>("insert into public.cycles (year, name) values (2026, 'Inspection cycle') returning id");
    const template = await pool.query<{ id: string }>(
      "select id from public.checklist_templates where module = 'accommodation' and is_active limit 1",
    );
    const entity = await pool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Inspection Entity', 'INSP-1', 'general_contractor') returning id",
    );
    const facility = await pool.query<{ id: string }>(
      "insert into public.facilities (entity_id, facility_code, name) values ($1, 'INSP-1-F1', 'Al Reem Labour Accommodation') returning id",
      [entity.rows[0]!.id],
    );
    facilityId = facility.rows[0]!.id;

    // The 12 accommodation areas, each with one key question. Production
    // has no questions seeded for this module yet (real regulatory
    // content pending from the client), so the test supplies one per area
    // to exercise the answer path.
    //
    // Questions must be inserted before any assessment references the
    // template: 0009_template_immutability.sql freezes a template the
    // moment an assessment points at it, which is the behaviour we want
    // and had to work with here rather than around.
    const requirements = await pool.query<{ id: string; sl_no: number }>(
      "select id, sl_no from public.requirements where template_id = $1 and deleted_at is null order by sl_no",
      [template.rows[0]!.id],
    );
    expect(requirements.rows).toHaveLength(12);

    const questionByRequirement = new Map<string, string>();
    for (const requirement of requirements.rows) {
      const question = await pool.query<{ id: string }>(
        "insert into public.questions (requirement_id, code, text) values ($1, 'Q1', $2) returning id",
        [requirement.id, `Key question for area ${requirement.sl_no}`],
      );
      questionByRequirement.set(requirement.id, question.rows[0]!.id);
    }

    const assessment = await pool.query<{ id: string }>(
      `insert into public.assessments (module, cycle_id, entity_id, facility_id, template_id, subject_code, assessment_type, actual_visit_date)
       values ('accommodation', $1, $2, $3, $4, '2026-ACM-IN-INSP-1', 'initial', '2026-06-01') returning id`,
      [cycle.rows[0]!.id, entity.rows[0]!.id, facilityId, template.rows[0]!.id],
    );
    assessmentId = assessment.rows[0]!.id;

    for (const requirement of requirements.rows) {
      const item = await pool.query<{ id: string }>(
        "insert into public.assessment_items (assessment_id, requirement_id) values ($1, $2) returning id",
        [assessmentId, requirement.id],
      );
      areaItems.push({ itemId: item.rows[0]!.id, slNo: requirement.sl_no, questionId: questionByRequirement.get(requirement.id)! });
    }
  });

  afterAll(async () => {
    await authenticatedPool.end();
    await pool.end();
  });

  it("applies a full 12-area, 20-photo inspection, then applies nothing at all on a full replay", async () => {
    const mutations = buildInspection();
    expect(mutations).toHaveLength(58);

    // Reconnect: the whole queue drains.
    const first = [];
    for (const mutation of mutations) first.push(await apply(mutation));
    expect(first.every((outcome) => outcome.applied && !outcome.duplicate)).toBe(true);

    const afterFirst = {
      answers: Number((await pool.query("select count(*) from public.assessment_answers")).rows[0].count),
      photos: Number((await pool.query("select count(*) from public.photos")).rows[0].count),
      rooms: Number((await pool.query("select count(*) from public.rooms")).rows[0].count),
      log: Number((await pool.query("select count(*) from public.inspection_sync_log")).rows[0].count),
    };
    expect(afterFirst).toEqual({ answers: 12, photos: 20, rooms: 2, log: 58 });

    // The dangerous case: the client never got the acknowledgements and
    // replays the entire queue.
    const replay = [];
    for (const mutation of mutations) replay.push(await apply(mutation));
    expect(replay.every((outcome) => !outcome.applied && outcome.duplicate)).toBe(true);

    const afterReplay = {
      answers: Number((await pool.query("select count(*) from public.assessment_answers")).rows[0].count),
      photos: Number((await pool.query("select count(*) from public.photos")).rows[0].count),
      rooms: Number((await pool.query("select count(*) from public.rooms")).rows[0].count),
      log: Number((await pool.query("select count(*) from public.inspection_sync_log")).rows[0].count),
    };
    expect(afterReplay).toEqual(afterFirst);
  });

  it("records capture time, geolocation and the room a photo belongs to", async () => {
    const { rows } = await pool.query(
      "select captured_at, geo_lat, geo_lng, room_ref, uploaded_by from public.photos order by captured_at limit 1",
    );

    expect(rows[0]!.captured_at).not.toBeNull();
    expect(Number(rows[0]!.geo_lat)).toBeCloseTo(24.4539, 4);
    expect(Number(rows[0]!.geo_lng)).toBeCloseTo(54.3773, 4);
    expect(rows[0]!.room_ref).toBe("A-101");
    expect(rows[0]!.uploaded_by).toBe(assessorId);
  });

  it("records the assessor's own physical bed and occupancy counts as a manual room source", async () => {
    const { rows } = await pool.query("select room_ref, bed_count, occupancy_count, source, confirmed_by from public.rooms order by room_ref");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ room_ref: "A-101", bed_count: 8, occupancy_count: 8, source: "manual", confirmed_by: assessorId });
  });

  it("puts an area rating through the assessor-decision trigger, stamping and auditing it", async () => {
    const item = areaItems[0]!;
    const { rows } = await pool.query("select compliance_status, decided_by, decided_at from public.assessment_items where id = $1", [item.itemId]);

    expect(rows[0]!.compliance_status).toBe("Compliant");
    expect(rows[0]!.decided_by).toBe(assessorId);
    expect(rows[0]!.decided_at).not.toBeNull();

    const audit = await pool.query("select action from public.audit_log where entity_id = $1 and action = 'assessment_item.decide'", [item.itemId]);
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it("appends certificates rather than overwriting, so two captured offline both survive", async () => {
    const item = areaItems[0]!;

    await apply({
      clientMutationId: randomUUID(),
      kind: "certificate",
      payload: { assessment_item_id: item.itemId, certificate: { type: "Civil Defence", number: "CD-1", valid_to: "2027-01-31" } },
    });
    await apply({
      clientMutationId: randomUUID(),
      kind: "certificate",
      payload: { assessment_item_id: item.itemId, certificate: { type: "Municipality", number: "MU-9", valid_to: "2026-12-31" } },
    });

    const { rows } = await pool.query("select quantitative -> 'certificates' as certificates from public.assessment_items where id = $1", [item.itemId]);
    const certificates = rows[0]!.certificates as { type: string; valid_to: string }[];

    expect(certificates).toHaveLength(2);
    expect(certificates.map((entry) => entry.type)).toEqual(["Civil Defence", "Municipality"]);
    // The quantitative capture from the same area is still intact.
    const kept = await pool.query("select quantitative -> 'captured' as captured from public.assessment_items where id = $1", [item.itemId]);
    expect(kept.rows[0]!.captured).toBe(true);
  });

  it("refuses to sync for someone who is not an assessor", async () => {
    const viewer = await pool.query<{ id: string }>("insert into auth.users default values returning id");
    await pool.query("insert into public.users (id, full_name, role, active) values ($1, 'Viewer', 'client_viewer', true)", [viewer.rows[0]!.id]);

    await expect(
      asUser(authenticatedPool, viewer.rows[0]!.id, (client) =>
        client.query("select public.apply_inspection_mutation($1, $2, 'room_count', $3)", [
          randomUUID(),
          assessmentId,
          JSON.stringify({ room_ref: "X-1", bed_count: 4, occupancy_count: 4 }),
        ]),
      ),
    ).rejects.toThrow(/only an admin or assessor may sync/);
  });

  it("feeds the synced quantitative fields into the rule engine and produces evaluations", async () => {
    // Area 3 (Bathrooms) synced residents/toilets/showers/washbasins.
    // ACM_TOILET_RATIO reads exactly those, and nothing else had to
    // happen in between — the inspection's own capture is the input.
    const bathrooms = areaItems.find((area) => area.slNo === 3)!;
    const { rows: stored } = await pool.query("select quantitative from public.assessment_items where id = $1", [bathrooms.itemId]);
    const quantitative = stored[0]!.quantitative as Record<string, unknown>;
    expect(quantitative).toMatchObject({ residents: 96, toilets: 8, showers: 12, washbasins: 12 });

    const result = await runAndStore(pgEvaluationDb(pool), ["ACM_TOILET_RATIO"], [
      {
        assessmentItemId: bathrooms.itemId,
        subjectRef: null,
        inputs: { facts: {}, quantitative, assessmentDate: "2026-06-01" },
      },
    ]);

    expect(result.problems).toEqual([]);
    expect(result.storedCount).toBe(1);

    const { rows } = await pool.query(
      "select result, computed_explanation, thresholds from public.rule_evaluations where assessment_item_id = $1 and rule_code = 'ACM_TOILET_RATIO'",
      [bathrooms.itemId],
    );

    expect(rows).toHaveLength(1);
    // 96 residents at 1 per 8 needs 12 toilets; 8 were counted on site.
    expect(rows[0]!.result).toBe("fail");
    expect(rows[0]!.computed_explanation).toContain("96 residents");
    expect(rows[0]!.computed_explanation).toContain("toilets 8 of 12 required");
    expect(rows[0]!.thresholds).toEqual({ maxResidentsPerToilet: 8, maxResidentsPerShower: 8, maxResidentsPerWashbasin: 8 });
  });
});
