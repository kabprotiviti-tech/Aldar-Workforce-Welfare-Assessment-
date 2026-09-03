import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAndStore, type EvaluationDb, type LoadedRuleDefinition, type StoredEvaluation } from "@/lib/rules/compliance/evaluate";
import type { EvaluationSubject } from "@/lib/rules/compliance/evaluate";
import { proposeRoomMeasurements } from "@/lib/rooms/propose";
import { roomQuantitative, type RoomRow } from "@/lib/rooms/subjects";
import type { GroupedFact } from "@/lib/rooms/group-facts";
import { ADMIN_DATABASE_URL, asUser, authenticatedDatabaseUrl, isReachable, resetAndMigrate } from "./helpers";

/**
 * This prompt's acceptance criteria, proven against real Postgres:
 * - "No m² per person value can exist without a confirmed area AND a
 *   confirmed occupancy; the field is null and the rule returns
 *   insufficient_data otherwise."
 * - "The report shows the source of the area: drawing, measured on
 *   site, or both."
 *
 * The pure grouping and area arithmetic are proven in isolation
 * (lib/rooms/*.test.ts); this test proves the pipeline they feed into:
 * confirmed facts with group_ref -> a computed proposal -> a room row a
 * person must still confirm -> a rule result that only exists once both
 * halves are confirmed.
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
  console.warn(`Skipping room area test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("drawing-based room area against a real database", () => {
  let authenticatedPool: Pool;
  let assessorId: string;
  let viewerId: string;
  let facilityId: string;
  let assessmentId: string;
  let assessmentItemId: string;
  let assessmentDate: string;

  /** Inserts one accepted (ledger-confirmed) fact, the shape a real extraction + ledger accept produces. */
  async function insertConfirmedFact(input: {
    extractionId: string;
    evidenceFileId: string;
    factKey: string;
    groupRef: string | null;
    valueNumber?: number;
    valueText?: string;
    confidence: "high" | "medium" | "low";
  }): Promise<void> {
    await pool.query(
      `insert into public.extracted_facts
         (extraction_id, evidence_file_id, fact_key, group_ref, value_number, value_text, confidence, status, resolved_by, resolved_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'accepted', $8, now())`,
      [input.extractionId, input.evidenceFileId, input.factKey, input.groupRef, input.valueNumber ?? null, input.valueText ?? null, input.confidence, assessorId],
    );
  }

  async function insertEvidenceAndExtraction(documentClass: string): Promise<{ evidenceFileId: string; extractionId: string }> {
    const evidence = await pool.query<{ id: string }>(
      `insert into public.evidence_files (assessment_id, storage_path, original_name, mime_type, size_bytes, document_class, uploaded_by)
       values ($1, $2, $3, 'application/pdf', 1024, $4, $5) returning id`,
      [assessmentId, `evidence/${randomUUID()}.pdf`, "drawing.pdf", documentClass, assessorId],
    );
    const extraction = await pool.query<{ id: string }>(
      `insert into public.extractions (evidence_file_id, model, prompt_version) values ($1, 'claude-test', 'v2') returning id`,
      [evidence.rows[0]!.id],
    );
    return { evidenceFileId: evidence.rows[0]!.id, extractionId: extraction.rows[0]!.id };
  }

  async function loadConfirmedGroupedFacts(): Promise<GroupedFact[]> {
    const { rows } = await pool.query(
      "select fact_key, group_ref, confirmed_value, confidence from public.fact_ledger_confirmed where assessment_id = $1",
      [assessmentId],
    );
    return rows.map((row) => ({ factKey: row.fact_key, groupRef: row.group_ref, confirmedValue: row.confirmed_value, confidence: row.confidence }));
  }

  async function propose(drawingSourceFileId: string | null): Promise<void> {
    const proposals = proposeRoomMeasurements(await loadConfirmedGroupedFacts());
    await asUser(authenticatedPool, assessorId, (client) =>
      client.query("select public.propose_room_measurements($1, $2, $3::jsonb)", [
        facilityId,
        drawingSourceFileId,
        JSON.stringify(
          proposals.map((proposal) => ({
            room_ref: proposal.roomRef,
            drawing_area_m2: proposal.drawingAreaM2,
            low_confidence: proposal.lowConfidence,
            schedule_occupancy_headcount: proposal.scheduleOccupancyHeadcount,
          })),
        ),
      ]),
    );
  }

  async function roomRow(roomRef: string): Promise<Record<string, unknown>> {
    const { rows } = await pool.query(
      `select id, drawing_area_m2, drawing_area_low_confidence, measured_area_m2, area_confirmed_at,
              occupancy_count, occupancy_source, occupancy_confirmed_at, schedule_occupancy_headcount,
              source, computed_m2_per_person
       from public.rooms where facility_id = $1 and room_ref = $2`,
      [facilityId, roomRef],
    );
    return rows[0]!;
  }

  async function resolveArea(roomId: string, action: "confirm" | "override", measuredAreaM2: number | null, asUserId: string = assessorId): Promise<void> {
    await asUser(authenticatedPool, asUserId, (client) =>
      client.query("select public.resolve_room_area($1, $2, $3)", [roomId, action, measuredAreaM2]),
    );
  }

  async function evaluateRoom(subject: EvaluationSubject) {
    return runAndStore(pgEvaluationDb(pool), ["R18_ROOM_AREA", "ACM_OCCUPANCY_RECONCILED"], [subject]);
  }

  async function subjectFor(roomRef: string): Promise<EvaluationSubject> {
    const row = await roomRow(roomRef);
    const roomInput: RoomRow = {
      roomRef,
      areaConfirmedAt: row.area_confirmed_at as string | null,
      measuredAreaM2: row.measured_area_m2 === null ? null : Number(row.measured_area_m2),
      drawingAreaM2: row.drawing_area_m2 === null ? null : Number(row.drawing_area_m2),
      occupancyConfirmedAt: row.occupancy_confirmed_at as string | null,
      occupancyCount: row.occupancy_count === null ? null : Number(row.occupancy_count),
      occupancySource: row.occupancy_source as RoomRow["occupancySource"],
      scheduleOccupancyHeadcount: row.schedule_occupancy_headcount === null ? null : Number(row.schedule_occupancy_headcount),
    };
    return { assessmentItemId, subjectRef: roomRef, inputs: { facts: {}, quantitative: roomQuantitative(roomInput), assessmentDate } };
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

    const cycle = await pool.query<{ id: string }>("insert into public.cycles (year, name) values (2026, 'Room area cycle') returning id");
    const template = await pool.query<{ id: string }>(
      "select id from public.checklist_templates where module = 'employment_practices' and is_active limit 1",
    );
    const requirement = await pool.query<{ id: string }>(
      "select id from public.requirements where template_id = $1 and sl_no = 18 and deleted_at is null",
      [template.rows[0]!.id],
    );
    const entity = await pool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Room Area Entity', 'RA-1', 'general_contractor') returning id",
    );
    const facility = await pool.query<{ id: string }>(
      "insert into public.facilities (entity_id, facility_code, name) values ($1, 'RA-1-F1', 'Room Area Accommodation') returning id",
      [entity.rows[0]!.id],
    );
    facilityId = facility.rows[0]!.id;

    assessmentDate = "2026-06-01";
    const assessment = await pool.query<{ id: string }>(
      `insert into public.assessments (module, cycle_id, entity_id, facility_id, template_id, subject_code, assessment_type, actual_visit_date)
       values ('employment_practices', $1, $2, $3, $4, '2026-EP-IN-RA-1', 'initial', $5) returning id`,
      [cycle.rows[0]!.id, entity.rows[0]!.id, facilityId, template.rows[0]!.id, assessmentDate],
    );
    assessmentId = assessment.rows[0]!.id;

    const item = await pool.query<{ id: string }>(
      "insert into public.assessment_items (assessment_id, requirement_id) values ($1, $2) returning id",
      [assessmentId, requirement.rows[0]!.id],
    );
    assessmentItemId = item.rows[0]!.id;
  });

  afterAll(async () => {
    await authenticatedPool.end();
    await pool.end();
  });

  it("proposes a room's area from a printed value, another from printed dimensions, and withholds a low-confidence reading", async () => {
    const { evidenceFileId, extractionId } = await insertEvidenceAndExtraction("approved_drawing");

    await insertConfirmedFact({ extractionId, evidenceFileId, factKey: "drawing_room_ref", groupRef: "204", valueText: "204", confidence: "high" });
    await insertConfirmedFact({ extractionId, evidenceFileId, factKey: "drawing_room_area_value", groupRef: "204", valueNumber: 26.4, confidence: "high" });
    await insertConfirmedFact({ extractionId, evidenceFileId, factKey: "drawing_room_area_unit", groupRef: "204", valueText: "m2", confidence: "high" });

    await insertConfirmedFact({ extractionId, evidenceFileId, factKey: "drawing_room_ref", groupRef: "205", valueText: "205", confidence: "high" });
    await insertConfirmedFact({ extractionId, evidenceFileId, factKey: "drawing_room_dimension_a", groupRef: "205", valueNumber: 6.2, confidence: "high" });
    await insertConfirmedFact({ extractionId, evidenceFileId, factKey: "drawing_room_dimension_b", groupRef: "205", valueNumber: 4.1, confidence: "high" });
    await insertConfirmedFact({ extractionId, evidenceFileId, factKey: "drawing_room_dimension_unit", groupRef: "205", valueText: "m", confidence: "high" });

    await insertConfirmedFact({ extractionId, evidenceFileId, factKey: "drawing_room_ref", groupRef: "206", valueText: "206", confidence: "low" });
    await insertConfirmedFact({ extractionId, evidenceFileId, factKey: "drawing_room_area_value", groupRef: "206", valueNumber: 12, confidence: "low" });
    await insertConfirmedFact({ extractionId, evidenceFileId, factKey: "drawing_room_area_unit", groupRef: "206", valueText: "m2", confidence: "low" });

    await propose(evidenceFileId);

    const room204 = await roomRow("204");
    expect(Number(room204.drawing_area_m2)).toBe(26.4);
    expect(room204.area_confirmed_at).toBeNull();
    expect(room204.drawing_area_low_confidence).toBe(false);

    const room205 = await roomRow("205");
    expect(Number(room205.drawing_area_m2)).toBeCloseTo(25.42, 2);

    const room206 = await roomRow("206");
    expect(room206.drawing_area_m2).toBeNull();
    expect(room206.drawing_area_low_confidence).toBe(true);
  });

  it("proposes a schedule occupancy figure independently, and reflects it even for a room with no drawing reading", async () => {
    const { evidenceFileId, extractionId } = await insertEvidenceAndExtraction("occupancy_schedule");
    await insertConfirmedFact({ extractionId, evidenceFileId, factKey: "occupancy_room_ref", groupRef: "204", valueText: "204", confidence: "high" });
    await insertConfirmedFact({ extractionId, evidenceFileId, factKey: "occupancy_headcount", groupRef: "204", valueNumber: 8, confidence: "high" });
    await insertConfirmedFact({ extractionId, evidenceFileId, factKey: "occupancy_room_ref", groupRef: "205", valueText: "205", confidence: "high" });
    await insertConfirmedFact({ extractionId, evidenceFileId, factKey: "occupancy_headcount", groupRef: "205", valueNumber: 4, confidence: "high" });

    await propose(null);

    expect(Number((await roomRow("204")).schedule_occupancy_headcount)).toBe(8);
    expect(Number((await roomRow("205")).schedule_occupancy_headcount)).toBe(4);
  });

  it("has no m² per person value until both the area and the occupancy are confirmed — the DB field itself", async () => {
    const before = await roomRow("204");
    expect(before.computed_m2_per_person).toBeNull();

    await resolveArea((await roomRow("204")).id as string, "confirm", null);
    const areaOnly = await roomRow("204");
    expect(areaOnly.area_confirmed_at).not.toBeNull();
    expect(areaOnly.computed_m2_per_person).toBeNull(); // occupancy still unconfirmed

    await asUser(authenticatedPool, assessorId, (client) =>
      client.query("select public.apply_inspection_mutation($1, $2, 'room_count', $3::jsonb)", [
        randomUUID(),
        assessmentId,
        JSON.stringify({ room_ref: "204", bed_count: 8, occupancy_count: 8 }),
      ]),
    );

    const both = await roomRow("204");
    expect(both.occupancy_confirmed_at).not.toBeNull();
    expect(both.occupancy_source).toBe("physical_count");
    expect(Number(both.computed_m2_per_person)).toBeCloseTo(26.4 / 8, 5);
  });

  it("records the area's source as drawing, manual, or both, for the report to show", async () => {
    expect((await roomRow("204")).source).toBe("drawing");

    const room206 = await roomRow("206");
    await resolveArea(room206.id as string, "override", 12.5);
    // 206 never had a confirmed drawing figure (it was withheld for low
    // confidence), so an override with nothing else confirmed is "manual".
    expect((await roomRow("206")).source).toBe("manual");

    const room205 = await roomRow("205");
    await resolveArea(room205.id as string, "override", 25.0);
    // 205 did have a drawing-computed figure on record; overriding it
    // with a measurement is "both", not "manual".
    expect((await roomRow("205")).source).toBe("both");
  });

  it("refuses to confirm a drawing area that was never proposed", async () => {
    const orphan = await pool.query<{ id: string }>(
      "insert into public.rooms (facility_id, room_ref) values ($1, '999') returning id",
      [facilityId],
    );
    await expect(resolveArea(orphan.rows[0]!.id, "confirm", null)).rejects.toThrow(/no drawing-derived area to confirm/i);
  });

  it("refuses an override with a non-positive measured area", async () => {
    const room206 = await roomRow("206");
    await expect(resolveArea(room206.id as string, "override", 0)).rejects.toThrow(/needs a positive measured area/i);
    await expect(resolveArea(room206.id as string, "override", null)).rejects.toThrow(/needs a positive measured area/i);
  });

  it("refuses anyone who is not staff", async () => {
    const room204 = await roomRow("204");
    await expect(resolveArea(room204.id as string, "confirm", null, viewerId)).rejects.toThrow(/only staff may confirm/i);
  });

  it("promotes the occupancy schedule's figure only when asked, and audits the decision", async () => {
    const room205 = await roomRow("205");
    expect(room205.occupancy_confirmed_at).toBeNull();

    await asUser(authenticatedPool, assessorId, (client) => client.query("select public.confirm_room_occupancy_from_schedule($1)", [room205.id]));

    const after = await roomRow("205");
    expect(Number(after.occupancy_count)).toBe(4);
    expect(after.occupancy_source).toBe("schedule");
    expect(after.occupancy_confirmed_at).not.toBeNull();

    const audit = await pool.query("select action, actor_id from public.audit_log where entity_type = 'room' and entity_id = $1", [room205.id]);
    expect(audit.rows.map((row) => row.action)).toContain("room.occupancy_confirm_schedule");
    expect(audit.rows.every((row) => row.actor_id === assessorId)).toBe(true);
  });

  it("refuses to promote a schedule figure that doesn't exist", async () => {
    const orphan = await pool.query<{ id: string }>(
      "insert into public.rooms (facility_id, room_ref) values ($1, '888') returning id",
      [facilityId],
    );
    await expect(
      asUser(authenticatedPool, assessorId, (client) => client.query("select public.confirm_room_occupancy_from_schedule($1)", [orphan.rows[0]!.id])),
    ).rejects.toThrow(/no occupancy schedule figure/i);
  });

  it("R18_ROOM_AREA returns insufficient_data for a confirmed area with no confirmed occupancy, naming what's missing", async () => {
    const orphan = await pool.query<{ id: string }>(
      "insert into public.rooms (facility_id, room_ref, drawing_area_m2, area_confirmed_at, area_confirmed_by, source) values ($1, '301', 20, now(), $2, 'drawing') returning id",
      [facilityId, assessorId],
    );
    const subject = await subjectFor("301");
    expect(subject.inputs.quantitative.room_occupancy).toBeUndefined();

    const result = await evaluateRoom(subject);
    const areaResult = result.stored.find((row) => row.ruleCode === "R18_ROOM_AREA");
    expect(areaResult!.outcome).toBe("insufficient_data");
    expect(areaResult!.missingFactKeys).toEqual(["room_occupancy or occupancy_headcount"]);
    void orphan;
  });

  it("R18_ROOM_AREA computes and stores a real result once both the area and the occupancy are confirmed", async () => {
    const subject = await subjectFor("204");
    expect(subject.inputs.quantitative).toEqual({ room_area_m2: 26.4, room_occupancy: 8, room_occupancy_physical: 8, room_occupancy_schedule: 8 });

    const result = await evaluateRoom(subject);
    const areaResult = result.stored.find((row) => row.ruleCode === "R18_ROOM_AREA");
    // 26.4 m² / 8 residents = 3.30 m², below the 4.00 m² minimum — a real,
    // stored fail, not a placeholder pass.
    expect(areaResult!.outcome).toBe("fail");
    expect(areaResult!.computedExplanation).toContain("26.4 m² / 8 residents");
  });

  it("ACM_OCCUPANCY_RECONCILED passes when the physical count matches the schedule, and fails a genuine mismatch", async () => {
    const matching = await evaluateRoom(await subjectFor("204"));
    expect(matching.stored.find((row) => row.ruleCode === "ACM_OCCUPANCY_RECONCILED")!.outcome).toBe("pass");

    const mismatch = await pool.query<{ id: string }>(
      `insert into public.rooms (facility_id, room_ref, occupancy_count, occupancy_source, occupancy_confirmed_at, occupancy_confirmed_by, schedule_occupancy_headcount)
       values ($1, '302', 6, 'physical_count', now(), $2, 9) returning id`,
      [facilityId, assessorId],
    );
    void mismatch;
    const result = await evaluateRoom(await subjectFor("302"));
    const reconciled = result.stored.find((row) => row.ruleCode === "ACM_OCCUPANCY_RECONCILED")!;
    expect(reconciled.outcome).toBe("fail");
    expect(reconciled.computedExplanation).toContain("Difference of 3 residents");
  });

  it("re-proposing never overwrites a confirmed area, but does refresh the schedule occupancy figure", async () => {
    const before = await roomRow("204");
    expect(Number(before.drawing_area_m2)).toBe(26.4);

    const { evidenceFileId, extractionId } = await insertEvidenceAndExtraction("approved_drawing");
    await insertConfirmedFact({ extractionId, evidenceFileId, factKey: "drawing_room_ref", groupRef: "204", valueText: "204", confidence: "high" });
    await insertConfirmedFact({ extractionId, evidenceFileId, factKey: "drawing_room_area_value", groupRef: "204", valueNumber: 999, confidence: "high" });
    await insertConfirmedFact({ extractionId, evidenceFileId, factKey: "drawing_room_area_unit", groupRef: "204", valueText: "m2", confidence: "high" });

    const { evidenceFileId: scheduleFile, extractionId: scheduleExtraction } = await insertEvidenceAndExtraction("occupancy_schedule");
    await insertConfirmedFact({ extractionId: scheduleExtraction, evidenceFileId: scheduleFile, factKey: "occupancy_room_ref", groupRef: "204", valueText: "204", confidence: "high" });
    await insertConfirmedFact({ extractionId: scheduleExtraction, evidenceFileId: scheduleFile, factKey: "occupancy_headcount", groupRef: "204", valueNumber: 10, confidence: "high" });

    await propose(evidenceFileId);

    const after = await roomRow("204");
    // The confirmed area is untouched — a re-run of the extraction (or a
    // second drawing) cannot silently change a value a person confirmed.
    expect(Number(after.drawing_area_m2)).toBe(26.4);
    // The schedule figure is purely informational and is refreshed.
    expect(Number(after.schedule_occupancy_headcount)).toBe(10);
  });
});
