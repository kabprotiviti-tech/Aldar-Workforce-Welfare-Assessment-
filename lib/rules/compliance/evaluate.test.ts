import { describe, expect, it } from "vitest";
import { evaluateSubjects, runAndStore, tallyOutcomes, type EvaluationDb, type EvaluationSubject, type LoadedRuleDefinition, type StoredEvaluation } from "./evaluate";

function definition(overrides: Partial<LoadedRuleDefinition> = {}): LoadedRuleDefinition {
  return {
    id: "def-room-area",
    code: "R18_ROOM_AREA",
    version: 1,
    threshold: null,
    legalReference: "seeded reference",
    ...overrides,
  };
}

function subject(overrides: Partial<EvaluationSubject> = {}): EvaluationSubject {
  return {
    assessmentItemId: "item-1",
    subjectRef: "Room A-101",
    inputs: { facts: { drawing_room_area_m2: 26.4, occupancy_headcount: 8 }, quantitative: {}, assessmentDate: "2026-06-01" },
    ...overrides,
  };
}

function fakeDb(definitions: LoadedRuleDefinition[]): { db: EvaluationDb; written: StoredEvaluation[][] } {
  const written: StoredEvaluation[][] = [];
  return {
    written,
    db: {
      async loadDefinitions(codes) {
        return definitions.filter((entry) => codes.includes(entry.code));
      },
      async storeEvaluations(evaluations) {
        written.push(evaluations);
        return evaluations.length;
      },
    },
  };
}

describe("evaluateSubjects", () => {
  it("stamps the definition, its version, the thresholds used and the legal reference", async () => {
    const { db } = fakeDb([definition()]);

    const run = await evaluateSubjects(db, ["R18_ROOM_AREA"], [subject()]);

    expect(run.problems).toEqual([]);
    expect(run.stored).toHaveLength(1);
    expect(run.stored[0]).toMatchObject({
      assessmentItemId: "item-1",
      subjectRef: "Room A-101",
      ruleCode: "R18_ROOM_AREA",
      ruleDefinitionId: "def-room-area",
      ruleVersion: 1,
      outcome: "fail",
      legalReference: "seeded reference",
      thresholds: { minAreaPerResidentM2: 4 },
      missingFactKeys: [],
    });
    expect(run.stored[0]!.computedExplanation).toBe("26.4 m² / 8 residents = 3.30 m² per resident. Minimum 4.00 m². Below threshold.");
  });

  it("stamps a stored threshold override, and computes with it", async () => {
    const { db } = fakeDb([definition({ threshold: { minAreaPerResidentM2: 3 }, version: 2 })]);

    const run = await evaluateSubjects(db, ["R18_ROOM_AREA"], [subject()]);

    expect(run.stored[0]).toMatchObject({ outcome: "pass", ruleVersion: 2, thresholds: { minAreaPerResidentM2: 3 } });
  });

  it("keeps the rule's own reference when the definition row has none", async () => {
    const { db } = fakeDb([definition({ legalReference: null })]);

    const run = await evaluateSubjects(db, ["R18_ROOM_AREA"], [subject()]);

    expect(run.stored[0]!.legalReference).toContain("WWAP checklist requirement 18");
  });

  it("records insufficient_data with the missing keys, as a stored result of its own", async () => {
    const { db } = fakeDb([definition()]);

    const run = await evaluateSubjects(
      db,
      ["R18_ROOM_AREA"],
      [subject({ inputs: { facts: {}, quantitative: {}, assessmentDate: "2026-06-01" } })],
    );

    expect(run.stored[0]!.outcome).toBe("insufficient_data");
    expect(run.stored[0]!.missingFactKeys).toEqual([
      "room_area_m2 or drawing_room_area_m2",
      "room_occupancy or occupancy_headcount",
    ]);
  });

  it("evaluates every subject for every rule", async () => {
    const { db } = fakeDb([definition(), definition({ id: "def-headcount", code: "R18_ROOM_HEADCOUNT" })]);

    const run = await evaluateSubjects(db, ["R18_ROOM_AREA", "R18_ROOM_HEADCOUNT"], [
      subject({ subjectRef: "Room A-101" }),
      subject({ subjectRef: "Room A-102" }),
    ]);

    expect(run.stored).toHaveLength(4);
    expect(run.stored.map((entry) => `${entry.ruleCode}/${entry.subjectRef}`)).toEqual([
      "R18_ROOM_AREA/Room A-101",
      "R18_ROOM_AREA/Room A-102",
      "R18_ROOM_HEADCOUNT/Room A-101",
      "R18_ROOM_HEADCOUNT/Room A-102",
    ]);
  });

  it("reports a code with no implemented rule as a problem, storing nothing for it", async () => {
    const { db } = fakeDb([definition({ code: "R99_NOT_BUILT", id: "def-99" })]);

    const run = await evaluateSubjects(db, ["R99_NOT_BUILT"], [subject()]);

    expect(run.stored).toEqual([]);
    expect(run.problems).toEqual([{ ruleCode: "R99_NOT_BUILT", problem: 'No rule is implemented for code "R99_NOT_BUILT".' }]);
  });

  it("reports a rule with no active definition row as a problem", async () => {
    const { db } = fakeDb([]);

    const run = await evaluateSubjects(db, ["R18_ROOM_AREA"], [subject()]);

    expect(run.stored).toEqual([]);
    expect(run.problems).toEqual([{ ruleCode: "R18_ROOM_AREA", problem: 'No active rule_definitions row for "R18_ROOM_AREA".' }]);
  });

  it("reports invalid stored thresholds as a configuration problem, not as a result", async () => {
    // Storing insufficient_data here would disguise an admin's broken
    // threshold as missing evidence.
    const { db } = fakeDb([definition({ threshold: { minAreaPerResidentM2: "four" } })]);

    const run = await evaluateSubjects(db, ["R18_ROOM_AREA"], [subject()]);

    expect(run.stored).toEqual([]);
    expect(run.problems[0]!.ruleCode).toBe("R18_ROOM_AREA");
    expect(run.problems[0]!.problem).toContain("stored thresholds are not valid");
  });

  it("stops evaluating further subjects for a misconfigured rule", async () => {
    const { db } = fakeDb([definition({ threshold: { minAreaPerResidentM2: -1 } })]);

    const run = await evaluateSubjects(db, ["R18_ROOM_AREA"], [subject(), subject({ subjectRef: "Room A-102" })]);

    expect(run.problems).toHaveLength(1);
    expect(run.stored).toEqual([]);
  });

  it("evaluates nothing when there are no subjects", async () => {
    const { db } = fakeDb([definition()]);

    const run = await evaluateSubjects(db, ["R18_ROOM_AREA"], []);

    expect(run.stored).toEqual([]);
    expect(run.problems).toEqual([]);
  });
});

describe("runAndStore", () => {
  it("stores the batch in one append and reports the count", async () => {
    const { db, written } = fakeDb([definition()]);

    const result = await runAndStore(db, ["R18_ROOM_AREA"], [subject(), subject({ subjectRef: "Room A-102" })]);

    expect(result.storedCount).toBe(2);
    expect(written).toHaveLength(1);
    expect(written[0]).toHaveLength(2);
  });

  it("writes nothing at all when every rule was unrunnable", async () => {
    const { db, written } = fakeDb([]);

    const result = await runAndStore(db, ["R18_ROOM_AREA"], [subject()]);

    expect(result.storedCount).toBe(0);
    expect(written).toEqual([]);
    expect(result.problems).toHaveLength(1);
  });
});

describe("tallyOutcomes", () => {
  it("counts insufficient_data on its own, never folded into pass or fail", () => {
    const tally = tallyOutcomes([
      { outcome: "pass" },
      { outcome: "pass" },
      { outcome: "fail" },
      { outcome: "insufficient_data" },
      { outcome: "insufficient_data" },
      { outcome: "insufficient_data" },
    ]);

    expect(tally).toEqual({ pass: 2, fail: 1, insufficient_data: 3 });
  });

  it("counts an empty run as all zeroes", () => {
    expect(tallyOutcomes([])).toEqual({ pass: 0, fail: 0, insufficient_data: 0 });
  });
});
