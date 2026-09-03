import { describe, expect, it } from "vitest";
import { planAssessmentItems, type PreviousItemForGeneration, type RequirementForGeneration } from "@/lib/assessment/generate-items";
import { NO_PREVIOUS_ITEM } from "@/lib/assessment/carry-forward";

const REQUIREMENTS: RequirementForGeneration[] = [
  { requirementId: "r1", slNo: 1 },
  { requirementId: "r2", slNo: 2 },
];

describe("planAssessmentItems", () => {
  it("starts every item fresh when there is no previous assessment at all", () => {
    const plan = planAssessmentItems(REQUIREMENTS, new Map());
    expect(plan).toEqual([
      { requirementId: "r1", wasAssessed: true, snapshot: NO_PREVIOUS_ITEM },
      { requirementId: "r2", wasAssessed: true, snapshot: NO_PREVIOUS_ITEM },
    ]);
  });

  it("pre-populates a requirement that has a matching previous item, marked not yet assessed this cycle", () => {
    const previous: PreviousItemForGeneration = { itemId: "prev-1", complianceStatus: "Compliant", remarks: "All good", actionRequired: null };
    const plan = planAssessmentItems(REQUIREMENTS, new Map([["r1", previous]]));

    expect(plan[0]).toEqual({
      requirementId: "r1",
      wasAssessed: false,
      snapshot: { previousComplianceStatus: "Compliant", previousRemarks: "All good", previousActionRequired: null, carriedForwardFromItemId: "prev-1" },
    });
    // r2 has no previous item — a requirement the previous template didn't cover, or genuinely new.
    expect(plan[1]).toEqual({ requirementId: "r2", wasAssessed: true, snapshot: NO_PREVIOUS_ITEM });
  });

  it("carries a Partial status and its open action forward into the snapshot regardless of eligibility — eligibility is decided later, at the 'not assessed' action", () => {
    const previous: PreviousItemForGeneration = { itemId: "prev-2", complianceStatus: "Partial", remarks: "Missing signage", actionRequired: "Install signage" };
    const plan = planAssessmentItems([{ requirementId: "r1", slNo: 1 }], new Map([["r1", previous]]));

    expect(plan[0]!.snapshot).toEqual({
      previousComplianceStatus: "Partial",
      previousRemarks: "Missing signage",
      previousActionRequired: "Install signage",
      carriedForwardFromItemId: "prev-2",
    });
    expect(plan[0]!.wasAssessed).toBe(false);
  });

  it("produces one plan row per requirement, in the given order", () => {
    const plan = planAssessmentItems(REQUIREMENTS, new Map());
    expect(plan.map((row) => row.requirementId)).toEqual(["r1", "r2"]);
  });
});
