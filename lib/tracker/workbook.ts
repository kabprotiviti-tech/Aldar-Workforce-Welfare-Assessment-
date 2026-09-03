import ExcelJS from "exceljs";
import type { TrackerRowWithSummary } from "@/lib/tracker/rows";

/**
 * The tracker workbook itself (this prompt: "Excel project tracker...
 * written from platform activity, not maintained by hand"). Two sheets:
 * one row per assessment (the tracker a PM actually works from — a full
 * 95-facility cycle fits in one sheet, one file), and a detail sheet
 * with one row per requirement for anyone who needs the full breakdown
 * behind the summary column.
 */

const TRACKER_COLUMNS: { header: string; key: keyof TrackerRowWithSummary | "compliantCount" | "partialCount" | "notCompliantCount" | "notApplicableCount" | "notAssessedCount"; width: number }[] = [
  { header: "Subject Code", key: "subjectCode", width: 22 },
  { header: "Module", key: "module", width: 20 },
  { header: "Entity", key: "entityName", width: 24 },
  { header: "Facility", key: "facilityName", width: 24 },
  { header: "Audit Number", key: "auditNumber", width: 12 },
  { header: "Type", key: "assessmentType", width: 12 },
  { header: "RFI Issue Date", key: "rfiIssueDate", width: 16 },
  { header: "Desktop Assessment Date", key: "desktopAssessmentDate", width: 20 },
  { header: "Completed Desktop Assessment Date", key: "completedDesktopAssessmentDate", width: 24 },
  { header: "Office Visit Date", key: "officeVisitDate", width: 16 },
  { header: "Completed Visit Date", key: "completedVisitDate", width: 18 },
  { header: "Report Completion Date", key: "reportCompletionDate", width: 20 },
  { header: "Report QA Completion Date", key: "reportQaCompletionDate", width: 22 },
  { header: "Report Approval Date", key: "reportApprovalDate", width: 18 },
  { header: "Report Issuance Date", key: "reportIssuanceDate", width: 18 },
  { header: "Contact Name", key: "contactName", width: 20 },
  { header: "Contact Email", key: "contactEmail", width: 24 },
  { header: "Contact Phone", key: "contactPhone", width: 16 },
  { header: "Compliant", key: "compliantCount", width: 10 },
  { header: "Partial", key: "partialCount", width: 10 },
  { header: "Not Compliant", key: "notCompliantCount", width: 12 },
  { header: "Not Applicable", key: "notApplicableCount", width: 12 },
  { header: "Not Assessed", key: "notAssessedCount", width: 12 },
  { header: "Requirements by Rating", key: "requirementsByRatingSummary", width: 60 },
];

function styleHeaderRow(row: ExcelJS.Row): void {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F1EE" } };
  });
}

export async function buildTrackerWorkbook(rows: readonly TrackerRowWithSummary[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WWAP";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Tracker");
  sheet.columns = TRACKER_COLUMNS.map(({ header, key, width }) => ({ header, key, width }));
  for (const row of rows) {
    sheet.addRow({
      ...row,
      compliantCount: row.ratingCounts.Compliant,
      partialCount: row.ratingCounts.Partial,
      notCompliantCount: row.ratingCounts["Not Compliant"],
      notApplicableCount: row.ratingCounts["Not Applicable"],
      notAssessedCount: row.ratingCounts.notAssessed,
    });
  }
  styleHeaderRow(sheet.getRow(1));
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: TRACKER_COLUMNS.length } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const detailSheet = workbook.addWorksheet("Requirement Detail");
  detailSheet.columns = [
    { header: "Subject Code", key: "subjectCode", width: 22 },
    { header: "Requirement #", key: "requirementSlNo", width: 14 },
    { header: "Requirement Title", key: "requirementTitle", width: 50 },
    { header: "Rating", key: "rating", width: 16 },
  ];
  for (const row of rows) {
    for (const requirement of row.requirements) {
      detailSheet.addRow({
        subjectCode: row.subjectCode,
        requirementSlNo: requirement.requirementSlNo,
        requirementTitle: requirement.requirementTitle,
        rating: requirement.rating ?? "Not assessed",
      });
    }
  }
  styleHeaderRow(detailSheet.getRow(1));
  detailSheet.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
