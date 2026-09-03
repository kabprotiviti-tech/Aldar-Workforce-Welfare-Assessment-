import { describe, expect, it } from "vitest";
import { buildReportSnapshot, type BuildReportSnapshotInput } from "./snapshot";

const baseHeader: BuildReportSnapshotInput["header"] = {
  subjectCode: "2026-EP-IN-TEST-1",
  originatorName: "Test Assessor",
  description: null,
  assessmentType: "initial",
  module: "employment_practices",
  projectName: "2026 Annual Review",
  entityName: "Test Entity",
  facilityName: null,
  auditNumber: 1,
  isCurrent: true,
  reassessed: false,
  actualVisitDate: "2026-06-01",
  generatedAt: "2026-06-15T00:00:00Z",
  version: 1,
  riskRating: "Low",
  overallCompliancePct: 95,
  adjustedCompliancePct: 95,
  scoringWeightsVersion: 1,
};

describe("buildReportSnapshot", () => {
  it("carries the header through unchanged", () => {
    const snapshot = buildReportSnapshot({ header: baseHeader, items: [], accommodationItems: [], photos: [] });
    expect(snapshot.header).toEqual(baseHeader);
  });

  it("sorts rows by requirement number regardless of input order", () => {
    const snapshot = buildReportSnapshot({
      header: baseHeader,
      items: [
        { requirementSlNo: 5, requirementTitle: "Five", remarks: null, actionRequired: null, complianceStatus: "Compliant", wasAssessed: true },
        { requirementSlNo: 1, requirementTitle: "One", remarks: null, actionRequired: null, complianceStatus: "Compliant", wasAssessed: true },
      ],
      accommodationItems: [],
      photos: [],
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
      accommodationItems: [],
      photos: [],
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

  it("sorts accommodation groups by area number and carries key questions through", () => {
    const snapshot = buildReportSnapshot({
      header: baseHeader,
      items: [],
      accommodationItems: [
        {
          areaSlNo: 3,
          areaTitle: "Bathrooms",
          areaRating: "Compliant",
          areaRemarks: "Ratios within limits.",
          areaActionRequired: null,
          wasAssessed: true,
          keyQuestions: [{ questionText: "Is the toilet ratio compliant?", answer: "Yes", remark: null }],
        },
        {
          areaSlNo: 1,
          areaTitle: "General requirements",
          areaRating: "Partial",
          areaRemarks: "Capacity exceeded slightly.",
          areaActionRequired: "Reduce occupancy by 2.",
          wasAssessed: true,
          keyQuestions: [],
        },
      ],
      photos: [],
    });
    expect(snapshot.accommodationGroups.map((g) => g.areaSlNo)).toEqual([1, 3]);
    expect(snapshot.accommodationGroups[1]!.keyQuestions).toEqual([{ questionText: "Is the toilet ratio compliant?", answer: "Yes", remark: null }]);
  });

  it("an accommodation area with no key questions still forms a single-row group carrying the area's own rating", () => {
    const snapshot = buildReportSnapshot({
      header: baseHeader,
      items: [],
      accommodationItems: [
        { areaSlNo: 7, areaTitle: "Laundry", areaRating: "Compliant", areaRemarks: "Fine.", areaActionRequired: null, wasAssessed: true, keyQuestions: [] },
      ],
      photos: [],
    });
    expect(snapshot.accommodationGroups).toHaveLength(1);
    expect(snapshot.accommodationGroups[0]!.keyQuestions).toEqual([]);
  });

  it("sorts photos by area number, with unattributed photos (no area) first", () => {
    const snapshot = buildReportSnapshot({
      header: baseHeader,
      items: [],
      accommodationItems: [],
      photos: [
        { id: "p2", areaSlNo: 5, areaTitle: "Mess halls", caption: "Kitchen area", storagePath: "photos/p2.jpg" },
        { id: "p1", areaSlNo: 1, areaTitle: "General requirements", caption: "Entrance", storagePath: "photos/p1.jpg" },
      ],
    });
    expect(snapshot.photos.map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});
