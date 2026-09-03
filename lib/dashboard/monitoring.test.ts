import { describe, expect, it } from "vitest";
import {
  buildActionAgeingBuckets,
  buildAssessmentLineage,
  buildComplianceByRequirementAcrossCycles,
  buildRepeatFindingsByRequirementAndEntity,
} from "./monitoring";

describe("buildComplianceByRequirementAcrossCycles", () => {
  it("groups by requirement, then by cycle year sorted oldest first, tallying ratings", () => {
    const trends = buildComplianceByRequirementAcrossCycles([
      { cycleYear: 2026, requirementSlNo: 1, requirementTitle: "Recruitment fees", rating: "Compliant" },
      { cycleYear: 2025, requirementSlNo: 1, requirementTitle: "Recruitment fees", rating: "Not Compliant" },
      { cycleYear: 2026, requirementSlNo: 1, requirementTitle: "Recruitment fees", rating: "Compliant" },
      { cycleYear: 2026, requirementSlNo: 2, requirementTitle: "Wages", rating: null },
    ]);

    expect(trends.map((t) => t.requirementSlNo)).toEqual([1, 2]);
    const req1 = trends[0]!;
    expect(req1.byCycleYear.map((c) => c.cycleYear)).toEqual([2025, 2026]);
    expect(req1.byCycleYear[0]).toMatchObject({ notCompliant: 1, compliant: 0 });
    expect(req1.byCycleYear[1]).toMatchObject({ compliant: 2 });
    expect(trends[1]!.byCycleYear[0]).toMatchObject({ notAssessed: 1 });
  });
});

describe("buildRepeatFindingsByRequirementAndEntity", () => {
  it("groups repeat findings by requirement+entity and sorts by descending repeat count", () => {
    const groups = buildRepeatFindingsByRequirementAndEntity([
      { findingId: "f1", requirementSlNo: 11, requirementTitle: "Wages", entityId: "e1", entityName: "Acme" },
      { findingId: "f2", requirementSlNo: 11, requirementTitle: "Wages", entityId: "e1", entityName: "Acme" },
      { findingId: "f3", requirementSlNo: 14, requirementTitle: "Passports", entityId: "e2", entityName: "Beta" },
    ]);
    expect(groups[0]).toMatchObject({ requirementSlNo: 11, entityId: "e1", repeatCount: 2, findingIds: ["f1", "f2"] });
    expect(groups[1]).toMatchObject({ requirementSlNo: 14, entityId: "e2", repeatCount: 1 });
  });
});

describe("buildActionAgeingBuckets", () => {
  it("buckets open findings by days since raised, covering every bucket even at zero", () => {
    const groups = buildActionAgeingBuckets(
      [
        { findingId: "f1", title: "New", subjectCode: "2026-EP-IN-1", createdAt: "2026-02-25T00:00:00Z" }, // 4 days
        { findingId: "f2", title: "Mid", subjectCode: "2026-EP-IN-2", createdAt: "2026-01-15T00:00:00Z" }, // 45 days
        { findingId: "f3", title: "Old", subjectCode: "2026-EP-IN-3", createdAt: "2025-10-01T00:00:00Z" }, // >90 days
      ],
      "2026-03-01",
    );
    const byBucket = new Map(groups.map((g) => [g.bucket, g]));
    expect(byBucket.get("0-30")!.count).toBe(1);
    expect(byBucket.get("31-60")!.count).toBe(1);
    expect(byBucket.get("90+")!.count).toBe(1);
    expect(byBucket.get("61-90")!.count).toBe(0);
  });

  it("never produces a negative age for a finding created today", () => {
    const groups = buildActionAgeingBuckets([{ findingId: "f1", title: "New", subjectCode: "2026-EP-IN-1", createdAt: "2026-03-01T12:00:00Z" }], "2026-03-01");
    expect(groups.find((g) => g.bucket === "0-30")!.items[0]!.detail).toContain("open 0 days");
  });
});

describe("buildAssessmentLineage", () => {
  it("merges events from every source into one chronological trail", () => {
    const lineage = buildAssessmentLineage([
      { kind: "report_issued", at: "2026-02-20T00:00:00Z", label: "Report issued", detail: null },
      { kind: "rfi_issued", at: "2026-01-05T00:00:00Z", label: "RFI issued", detail: null },
      { kind: "finding_raised", at: "2026-02-01T00:00:00Z", label: "Finding raised", detail: "Late wages" },
    ]);
    expect(lineage.map((e) => e.kind)).toEqual(["rfi_issued", "finding_raised", "report_issued"]);
  });

  it("handles no events without throwing", () => {
    expect(buildAssessmentLineage([])).toEqual([]);
  });
});
