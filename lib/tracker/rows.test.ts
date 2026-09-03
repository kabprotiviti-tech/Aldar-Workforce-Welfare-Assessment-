import { describe, expect, it } from "vitest";
import { buildTrackerRows, summarizeRequirementsByRating, type TrackerRow } from "./rows";

describe("summarizeRequirementsByRating", () => {
  it("groups requirement numbers by rating, sorted ascending within each group", () => {
    const result = summarizeRequirementsByRating([
      { requirementSlNo: 3, requirementTitle: "C", rating: "Compliant" },
      { requirementSlNo: 1, requirementTitle: "A", rating: "Compliant" },
      { requirementSlNo: 2, requirementTitle: "B", rating: "Partial" },
    ]);
    expect(result.requirementsByRatingSummary).toBe("Compliant: 1, 3; Partial: 2");
    expect(result.ratingCounts).toEqual({ Compliant: 2, Partial: 1, "Not Compliant": 0, "Not Applicable": 0, notAssessed: 0 });
  });

  it("counts a null rating as not assessed, separate from every real rating", () => {
    const result = summarizeRequirementsByRating([
      { requirementSlNo: 1, requirementTitle: "A", rating: "Compliant" },
      { requirementSlNo: 2, requirementTitle: "B", rating: null },
    ]);
    expect(result.ratingCounts.notAssessed).toBe(1);
    expect(result.requirementsByRatingSummary).toContain("Not assessed: 1");
  });

  it("produces a readable message when there are no requirements at all", () => {
    expect(summarizeRequirementsByRating([]).requirementsByRatingSummary).toBe("No requirements recorded.");
  });

  it("omits a rating bucket entirely when nothing fell into it", () => {
    const result = summarizeRequirementsByRating([{ requirementSlNo: 1, requirementTitle: "A", rating: "Compliant" }]);
    expect(result.requirementsByRatingSummary).not.toContain("Partial");
    expect(result.requirementsByRatingSummary).not.toContain("Not Compliant");
  });
});

describe("buildTrackerRows", () => {
  function row(overrides: Partial<TrackerRow> = {}): TrackerRow {
    return {
      subjectCode: "2026-EP-IN-TEST-1",
      module: "employment_practices",
      entityName: "Test Entity",
      facilityName: null,
      auditNumber: 1,
      assessmentType: "initial",
      rfiIssueDate: "2026-01-05",
      desktopAssessmentDate: "2026-01-05",
      completedDesktopAssessmentDate: "2026-01-20",
      officeVisitDate: "2026-02-01",
      completedVisitDate: "2026-02-01",
      reportCompletionDate: "2026-02-10",
      reportQaCompletionDate: "2026-02-15",
      reportApprovalDate: "2026-02-20",
      reportIssuanceDate: "2026-02-20",
      contactName: "Jane Doe",
      contactEmail: "jane@example.com",
      contactPhone: null,
      requirements: [{ requirementSlNo: 1, requirementTitle: "A", rating: "Compliant" }],
      ...overrides,
    };
  }

  it("attaches a rating summary to every row, carrying every other field through unchanged", () => {
    const [result] = buildTrackerRows([row()]);
    expect(result!.subjectCode).toBe("2026-EP-IN-TEST-1");
    expect(result!.requirementsByRatingSummary).toBe("Compliant: 1");
    expect(result!.ratingCounts.Compliant).toBe(1);
  });

  it("handles a full cycle's worth of rows without dropping any", () => {
    const rows = Array.from({ length: 185 }, (_, i) => row({ subjectCode: `2026-EP-IN-TEST-${i + 1}` }));
    expect(buildTrackerRows(rows)).toHaveLength(185);
  });
});
