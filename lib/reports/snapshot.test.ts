import { describe, expect, it } from "vitest";
import { buildReportSnapshot, type BuildReportSnapshotInput } from "./snapshot";

const baseHeader: BuildReportSnapshotInput["header"] = {
  subjectCode: "2026-EP-IN-TEST-1",
  module: "employment_practices",
  assessmentType: "initial",
  entityName: "Test Entity",
  facilityName: null,
  auditNumber: 1,
  actualVisitDate: "2026-06-01",
  generatedAt: "2026-06-15T00:00:00Z",
  version: 1,
  riskRating: "Low",
  overallCompliancePct: 95,
  adjustedCompliancePct: 95,
};

describe("buildReportSnapshot", () => {
  it("carries the header through unchanged", () => {
    const snapshot = buildReportSnapshot({ header: baseHeader, items: [] });
    expect(snapshot.header).toEqual(baseHeader);
  });

  it("sorts rows by requirement number regardless of input order", () => {
    const snapshot = buildReportSnapshot({
      header: baseHeader,
      items: [
        { requirementSlNo: 5, requirementTitle: "Five", remarks: null, actionRequired: null, complianceStatus: "Compliant", wasAssessed: true },
        { requirementSlNo: 1, requirementTitle: "One", remarks: null, actionRequired: null, complianceStatus: "Compliant", wasAssessed: true },
      ],
    });
    expect(snapshot.rows.map((r) => r.requirementSlNo)).toEqual([1, 5]);
  });

  it("carries every row field through unchanged", () => {
    const snapshot = buildReportSnapshot({
      header: baseHeader,
      items: [
        {
          requirementSlNo: 11,
          requirementTitle: "Timely wage payment",
          remarks: "Wages late in two months.",
          actionRequired: "Transfer arrears by 30 June.",
          complianceStatus: "Not Compliant",
          wasAssessed: true,
        },
      ],
    });
    expect(snapshot.rows[0]).toEqual({
      requirementSlNo: 11,
      requirementTitle: "Timely wage payment",
      remarks: "Wages late in two months.",
      actionRequired: "Transfer arrears by 30 June.",
      complianceAssessment: "Not Compliant",
      wasAssessed: true,
    });
  });
});
