import { describe, expect, it } from "vitest";
import {
  generateAssessmentSet,
  targetKey,
  type AssessmentHistoryRow,
  type GenerateCycleDb,
  type GenerateCycleTarget,
  type NewAssessmentRow,
} from "./generate-cycle";

/**
 * An in-memory stand-in for GenerateCycleDb that counts how many times
 * each method is called. The real acceptance criterion ("95 facilities in
 * under 5 seconds") is a property of the number of round trips staying
 * fixed regardless of N, not of anything only a live database could show —
 * this proves that architecturally; tests/db/generate-cycle.perf.test.ts
 * separately proves it against a real Postgres instance with a wall-clock
 * budget. See docs/decisions.md.
 */
function fakeDb(options: {
  targets: GenerateCycleTarget[];
  templateId: string;
  history: AssessmentHistoryRow[];
  existingKeys: Set<string>;
}): { db: GenerateCycleDb; callCounts: Record<string, number>; inserted: NewAssessmentRow[] } {
  const callCounts: Record<string, number> = {
    activeTargets: 0,
    activeTemplateId: 0,
    history: 0,
    existingInCycle: 0,
    insertAssessments: 0,
  };
  const inserted: NewAssessmentRow[] = [];
  const db: GenerateCycleDb = {
    async activeTargets() {
      callCounts.activeTargets! += 1;
      return options.targets;
    },
    async activeTemplateId() {
      callCounts.activeTemplateId! += 1;
      return options.templateId;
    },
    async history() {
      callCounts.history! += 1;
      return options.history;
    },
    async existingInCycle() {
      callCounts.existingInCycle! += 1;
      return options.existingKeys;
    },
    async insertAssessments(rows) {
      callCounts.insertAssessments! += 1;
      inserted.push(...rows);
      return rows.length;
    },
  };
  return { db, callCounts, inserted };
}

function facilityTarget(index: number): GenerateCycleTarget {
  return {
    entityId: `entity-${index % 10}`,
    facilityId: `facility-${index}`,
    code: `FAC${index}`,
    accessPermissionRequired: index % 7 === 0,
  };
}

describe("generateAssessmentSet", () => {
  it("creates one assessment per target when there is no prior history", async () => {
    const targets = Array.from({ length: 95 }, (_, i) => facilityTarget(i));
    const { db, callCounts, inserted } = fakeDb({
      targets,
      templateId: "template-1",
      history: [],
      existingKeys: new Set(),
    });

    const result = await generateAssessmentSet(db, { cycleId: "cycle-1", cycleYear: 2026, module: "accommodation" });

    expect(result).toEqual({ created: 95, skipped: 0 });
    expect(inserted).toHaveLength(95);
    expect(inserted.every((r) => r.audit_number === 1)).toBe(true);
    // Audit number 1 -> no numeric suffix (subject-code.ts).
    expect(inserted[0]!.subject_code).toBe("2026-ACM-IN-FAC0");
    expect(inserted.every((r) => r.previous_assessment_id === null)).toBe(true);

    // Exactly one round trip per method, regardless of N — this is what
    // actually keeps bulk generation fast, not anything scaling with N.
    expect(callCounts).toEqual({
      activeTargets: 1,
      activeTemplateId: 1,
      history: 1,
      existingInCycle: 1,
      insertAssessments: 1,
    });
  });

  it("skips a target that already has an assessment this cycle", async () => {
    const targets = [facilityTarget(0), facilityTarget(1)];
    const { db, inserted } = fakeDb({
      targets,
      templateId: "template-1",
      history: [],
      existingKeys: new Set([targetKey("entity-0", "facility-0")]),
    });

    const result = await generateAssessmentSet(db, { cycleId: "cycle-1", cycleYear: 2026, module: "accommodation" });

    expect(result).toEqual({ created: 1, skipped: 1 });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.facility_id).toBe("facility-1");
  });

  it("increments the audit number from the target's most recent assessment", async () => {
    const targets = [facilityTarget(0)];
    const history: AssessmentHistoryRow[] = [
      { id: "a1", entityId: "entity-0", facilityId: "facility-0", auditNumber: 1, approvedAt: "2025-01-01", createdAt: "2025-01-01" },
      { id: "a2", entityId: "entity-0", facilityId: "facility-0", auditNumber: 2, approvedAt: "2025-06-01", createdAt: "2025-06-01" },
    ];
    const { db, inserted } = fakeDb({ targets, templateId: "template-1", history, existingKeys: new Set() });

    await generateAssessmentSet(db, { cycleId: "cycle-1", cycleYear: 2026, module: "accommodation" });

    expect(inserted[0]!.audit_number).toBe(3);
    expect(inserted[0]!.subject_code).toBe("2026-ACM-IN-FAC0-3");
  });

  it("links previous_assessment_id to the most recent approved assessment, skipping unapproved drafts", async () => {
    const targets = [facilityTarget(0)];
    const history: AssessmentHistoryRow[] = [
      { id: "approved-1", entityId: "entity-0", facilityId: "facility-0", auditNumber: 1, approvedAt: "2025-01-01", createdAt: "2025-01-01" },
      { id: "unapproved-draft", entityId: "entity-0", facilityId: "facility-0", auditNumber: 2, approvedAt: null, createdAt: "2025-06-01" },
    ];
    const { db, inserted } = fakeDb({ targets, templateId: "template-1", history, existingKeys: new Set() });

    await generateAssessmentSet(db, { cycleId: "cycle-1", cycleYear: 2026, module: "accommodation" });

    // Audit number sequencing still counts the unapproved draft (last audit
    // number 2, so this one becomes 3) — only the *link* skips it.
    expect(inserted[0]!.audit_number).toBe(3);
    expect(inserted[0]!.previous_assessment_id).toBe("approved-1");
  });

  it("carries a facility's access_permission_required flag onto the new assessment", async () => {
    const targets = [{ entityId: "entity-0", facilityId: "facility-0", code: "FAC0", accessPermissionRequired: true }];
    const { db, inserted } = fakeDb({ targets, templateId: "template-1", history: [], existingKeys: new Set() });

    await generateAssessmentSet(db, { cycleId: "cycle-1", cycleYear: 2026, module: "accommodation" });

    expect(inserted[0]!.permission_required).toBe(true);
  });

  it("does nothing when there are no active targets", async () => {
    const { db, callCounts } = fakeDb({ targets: [], templateId: "template-1", history: [], existingKeys: new Set() });

    const result = await generateAssessmentSet(db, { cycleId: "cycle-1", cycleYear: 2026, module: "employment_practices" });

    expect(result).toEqual({ created: 0, skipped: 0 });
    // Doesn't even ask for a template or existing rows once there is nothing to generate for.
    expect(callCounts.activeTemplateId).toBe(0);
  });
});
