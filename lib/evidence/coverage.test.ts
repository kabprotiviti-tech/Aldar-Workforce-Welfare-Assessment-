import { describe, expect, it } from "vitest";
import { computeCoverage, requirementsWithNoEvidence } from "./coverage";

const REQUIREMENTS = [
  { requirementId: "r3", slNo: 3, title: "Third" },
  { requirementId: "r1", slNo: 1, title: "First" },
  { requirementId: "r2", slNo: 2, title: "Second" },
];

describe("computeCoverage", () => {
  it("marks each requirement covered or not, sorted by sl_no", () => {
    const result = computeCoverage(REQUIREMENTS, new Set(["r1", "r3"]));
    expect(result).toEqual([
      { requirementId: "r1", slNo: 1, title: "First", hasEvidence: true },
      { requirementId: "r2", slNo: 2, title: "Second", hasEvidence: false },
      { requirementId: "r3", slNo: 3, title: "Third", hasEvidence: true },
    ]);
  });

  it("marks every requirement uncovered when nothing is linked", () => {
    const result = computeCoverage(REQUIREMENTS, new Set());
    expect(result.every((row) => !row.hasEvidence)).toBe(true);
  });

  it("marks every requirement covered when everything is linked", () => {
    const result = computeCoverage(REQUIREMENTS, new Set(["r1", "r2", "r3"]));
    expect(result.every((row) => row.hasEvidence)).toBe(true);
  });
});

describe("requirementsWithNoEvidence", () => {
  it("lists exactly the requirements with zero linked evidence (this prompt's acceptance criterion)", () => {
    const coverage = computeCoverage(REQUIREMENTS, new Set(["r1"]));
    expect(requirementsWithNoEvidence(coverage).map((r) => r.requirementId)).toEqual(["r2", "r3"]);
  });

  it("returns an empty list when every requirement has evidence", () => {
    const coverage = computeCoverage(REQUIREMENTS, new Set(["r1", "r2", "r3"]));
    expect(requirementsWithNoEvidence(coverage)).toEqual([]);
  });

  it("returns every requirement when none has evidence", () => {
    const coverage = computeCoverage(REQUIREMENTS, new Set());
    expect(requirementsWithNoEvidence(coverage)).toHaveLength(3);
  });
});
