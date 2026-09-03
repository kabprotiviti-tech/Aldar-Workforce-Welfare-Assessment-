import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildTrackerRows, type TrackerRow } from "./rows";
import { buildTrackerWorkbook } from "./workbook";

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
    requirements: [
      { requirementSlNo: 1, requirementTitle: "A", rating: "Compliant" },
      { requirementSlNo: 2, requirementTitle: "B", rating: "Partial" },
    ],
    ...overrides,
  };
}

describe("buildTrackerWorkbook", () => {
  it("produces a real xlsx file (starts with the zip magic bytes)", async () => {
    const bytes = await buildTrackerWorkbook(buildTrackerRows([row()]));
    expect(Buffer.from(bytes).subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("round-trips through ExcelJS with the Tracker sheet holding one row per assessment and the right values", async () => {
    const bytes = await buildTrackerWorkbook(buildTrackerRows([row(), row({ subjectCode: "2026-EP-IN-TEST-2" })]));

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);

    const sheet = workbook.getWorksheet("Tracker")!;
    expect(sheet.rowCount).toBe(3); // header + 2 assessments
    expect(sheet.getRow(1).getCell(1).value).toBe("Subject Code");
    expect(sheet.getRow(2).getCell(1).value).toBe("2026-EP-IN-TEST-1");
    expect(sheet.getRow(3).getCell(1).value).toBe("2026-EP-IN-TEST-2");
  });

  it("carries every requirement into the detail sheet, one row per requirement", async () => {
    const bytes = await buildTrackerWorkbook(buildTrackerRows([row()]));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);

    const detail = workbook.getWorksheet("Requirement Detail")!;
    expect(detail.rowCount).toBe(3); // header + 2 requirements
    expect(detail.getRow(2).getCell(3).value).toBe("A");
    expect(detail.getRow(3).getCell(4).value).toBe("Partial");
  });

  it("exports a full 95-facility cycle in one file without truncating any row", async () => {
    const rows = buildTrackerRows(Array.from({ length: 95 }, (_, i) => row({ subjectCode: `2026-ACM-IN-TEST-${i + 1}`, module: "accommodation" })));
    const bytes = await buildTrackerWorkbook(rows);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
    expect(workbook.getWorksheet("Tracker")!.rowCount).toBe(96);
  });
});
