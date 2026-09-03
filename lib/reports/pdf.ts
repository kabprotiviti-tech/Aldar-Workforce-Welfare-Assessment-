import PDFDocument from "pdfkit";
import type { AccommodationAreaGroup, ReportPhoto, ReportRow, ReportSnapshot } from "@/lib/reports/snapshot";
import type { ComplianceRating } from "@/lib/rules/constants";

/**
 * Renders a report snapshot into the client's report PDF format (this
 * prompt). A pure function of its inputs — no `new Date()`, no random
 * IDs, no reliance on anything outside `snapshot`/`options` — so the
 * same snapshot always produces byte-identical output
 * (tests/reports/pdf-determinism.test.ts, and this prompt's own
 * acceptance criterion: "regenerating a report for an approved
 * assessment produces a byte-identical PDF"). Every date shown comes
 * from `snapshot.header.generatedAt`, stamped once at generation time
 * and never recomputed here.
 *
 * Colours reuse CONTEXT.md's own design-language palette exactly
 * (compliant moss #2F5D3A, partial amber #8A6415, not-compliant brick
 * #9E3B33, not-applicable = secondary ink #565E64) — this prompt's
 * "colour coded" requirement, using the one set of brand colours this
 * project already has rather than inventing a second one.
 */

const COLORS = {
  ink: "#1B1F23",
  inkSecondary: "#565E64",
  hairline: "#E0DFDA",
  surface: "#FFFFFF",
  base: "#F2F1EE",
  compliant: "#2F5D3A",
  partial: "#8A6415",
  notCompliant: "#9E3B33",
  notApplicable: "#565E64",
} as const;

const RATING_COLOR: Record<ComplianceRating, string> = {
  Compliant: COLORS.compliant,
  Partial: COLORS.partial,
  "Not Compliant": COLORS.notCompliant,
  "Not Applicable": COLORS.notApplicable,
};

const PAGE = { size: "A4" as const, margin: 40 };
const CONTENT_WIDTH = 595.28 - PAGE.margin * 2; // A4 width in points, minus both margins.
const FOOTER_HEIGHT = 30;
const PAGE_BOTTOM = 841.89 - PAGE.margin - FOOTER_HEIGHT;

export interface RenderReportPdfOptions {
  logoBytes: Uint8Array | null;
  photos: { photo: ReportPhoto; bytes: Uint8Array }[];
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

function fmtPct(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function ratingLabel(rating: ComplianceRating | null): string {
  return rating ?? "Not yet decided";
}

/** A fixed instant derived from the snapshot's own generatedAt — never wall-clock, so metadata never varies between renders of the same snapshot. */
function fixedDate(snapshot: ReportSnapshot): Date {
  return new Date(snapshot.header.generatedAt);
}

export function renderReportPdf(snapshot: ReportSnapshot, options: RenderReportPdfOptions): Promise<Uint8Array> {
  const doc = new PDFDocument({
    size: PAGE.size,
    margin: PAGE.margin,
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: `${snapshot.header.subjectCode} — Worker Welfare Assessment Report`,
      Author: "WWAP",
      Producer: "WWAP",
      Creator: "WWAP",
      CreationDate: fixedDate(snapshot),
      ModDate: fixedDate(snapshot),
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  drawHeader(doc, snapshot, options.logoBytes);
  drawMetrics(doc, snapshot);

  if (snapshot.header.module === "accommodation") {
    drawAccommodationTable(doc, snapshot.accommodationGroups);
    if (options.photos.length > 0) {
      drawPhotoAppendix(doc, options.photos);
    }
  } else {
    drawRequirementsTable(doc, snapshot.rows);
  }

  drawFooters(doc, snapshot);

  const finished = new Promise<Uint8Array>((resolve, reject) => {
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
  });
  doc.end();
  return finished;
}

function drawHeader(doc: PDFKit.PDFDocument, snapshot: ReportSnapshot, logoBytes: Uint8Array | null): void {
  const { header } = snapshot;
  let y = PAGE.margin;

  if (logoBytes) {
    doc.image(Buffer.from(logoBytes), PAGE.margin, y, { fit: [90, 40] });
  }

  doc
    .fillColor(COLORS.ink)
    .fontSize(16)
    .text("Worker Welfare Assessment Report", PAGE.margin + (logoBytes ? 110 : 0), y, { width: CONTENT_WIDTH - (logoBytes ? 110 : 0) });

  y += 50;
  doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_WIDTH, y).strokeColor(COLORS.hairline).stroke();
  y += 12;

  const fields: [string, string][] = [
    ["Subject", header.subjectCode],
    ["Originator", header.originatorName ?? "—"],
    ["Date", fmtDate(header.generatedAt)],
    ["Description", header.description ?? "—"],
    ["Type", header.assessmentType === "follow_up" ? "Follow-up" : "Initial"],
    ["Project Type", moduleLabel(header.module)],
    ["Project Name", header.projectName ?? "—"],
    ["Associated Entity", header.entityName],
  ];
  if (header.module === "accommodation") {
    fields.push(["Accommodation Name", header.facilityName ?? "—"]);
  }
  fields.push(["Audit Number", String(header.auditNumber)]);
  fields.push(["Latest", header.isCurrent ? "Yes" : "No"]);
  fields.push(["Reassessed", header.reassessed ? "Yes" : "No"]);

  const colWidth = CONTENT_WIDTH / 2;
  let col = 0;
  let rowY = y;
  const rowHeight = 16;
  for (const [label, value] of fields) {
    const x = PAGE.margin + col * colWidth;
    doc.fontSize(8).fillColor(COLORS.inkSecondary).text(label.toUpperCase(), x, rowY, { width: colWidth - 10 });
    doc.fontSize(10).fillColor(COLORS.ink).text(value, x, rowY + 10, { width: colWidth - 10 });
    col += 1;
    if (col === 2) {
      col = 0;
      rowY += rowHeight + 14;
    }
  }
  if (col !== 0) rowY += rowHeight + 14;

  doc.y = rowY + 4;
}

function moduleLabel(module: ReportSnapshot["header"]["module"]): string {
  if (module === "employment_practices") return "Employment Practices";
  if (module === "onboarding") return "Onboarding";
  return "Accommodation";
}

function drawMetrics(doc: PDFKit.PDFDocument, snapshot: ReportSnapshot): void {
  const { header } = snapshot;
  const y = doc.y + 6;
  doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_WIDTH, y).strokeColor(COLORS.hairline).stroke();

  const metrics: [string, string][] = [
    ["Risk", header.riskRating ?? "N/A"],
    ["Overall Compliance", fmtPct(header.overallCompliancePct)],
    ["Compliance adjusted for not assessed", fmtPct(header.adjustedCompliancePct)],
  ];
  const colWidth = CONTENT_WIDTH / metrics.length;
  let x = PAGE.margin;
  const labelY = y + 12;
  for (const [label, value] of metrics) {
    doc.fontSize(8).fillColor(COLORS.inkSecondary).text(label.toUpperCase(), x, labelY, { width: colWidth - 10 });
    doc.fontSize(14).fillColor(COLORS.ink).text(value, x, labelY + 12, { width: colWidth - 10 });
    x += colWidth;
  }
  doc.fontSize(7).fillColor(COLORS.inkSecondary).text(`Scoring weights v${header.scoringWeightsVersion}`, PAGE.margin, labelY + 32);

  doc.y = labelY + 48;
}

interface ColumnSpec {
  label: string;
  width: number;
}

function ensureSpace(doc: PDFKit.PDFDocument, height: number): void {
  if (doc.y + height > PAGE_BOTTOM) {
    doc.addPage({ size: PAGE.size, margin: PAGE.margin });
  }
}

function drawTableHeaderRow(doc: PDFKit.PDFDocument, columns: ColumnSpec[]): void {
  ensureSpace(doc, 24);
  const y = doc.y;
  let x = PAGE.margin;
  doc.rect(PAGE.margin, y, CONTENT_WIDTH, 20).fill(COLORS.base);
  for (const column of columns) {
    doc.fontSize(8).fillColor(COLORS.inkSecondary).text(column.label.toUpperCase(), x + 4, y + 6, { width: column.width - 8 });
    x += column.width;
  }
  doc.y = y + 20;
}

/** Measures the tallest cell in a row, given each cell's text and its column width. */
function measureRowHeight(doc: PDFKit.PDFDocument, cells: string[], columns: ColumnSpec[]): number {
  let max = 18;
  cells.forEach((text, i) => {
    const h = doc.heightOfString(text || " ", { width: columns[i]!.width - 8 });
    if (h + 10 > max) max = h + 10;
  });
  return max;
}

function drawRow(doc: PDFKit.PDFDocument, cells: string[], columns: ColumnSpec[], options: { colorIndex?: number; color?: string } = {}): void {
  const height = measureRowHeight(doc, cells, columns);
  ensureSpace(doc, height);
  const y = doc.y;
  let x = PAGE.margin;

  doc.rect(PAGE.margin, y, CONTENT_WIDTH, height).strokeColor(COLORS.hairline).stroke();

  cells.forEach((text, i) => {
    const width = columns[i]!.width;
    if (options.colorIndex === i && options.color) {
      doc.rect(x, y, width, height).fill(options.color);
      doc.fillColor(COLORS.surface).fontSize(9).text(text, x + 4, y + 5, { width: width - 8 });
    } else {
      doc.fillColor(COLORS.ink).fontSize(9).text(text, x + 4, y + 5, { width: width - 8 });
    }
    x += width;
  });

  doc.y = y + height;
}

/** Worker Welfare Requirement | Remarks | Actions required for closure | Compliance Assessment. */
function drawRequirementsTable(doc: PDFKit.PDFDocument, rows: ReportRow[]): void {
  const columns: ColumnSpec[] = [
    { label: "Worker Welfare Requirement", width: CONTENT_WIDTH * 0.32 },
    { label: "Remarks", width: CONTENT_WIDTH * 0.28 },
    { label: "Actions required for closure", width: CONTENT_WIDTH * 0.24 },
    { label: "Compliance Assessment", width: CONTENT_WIDTH * 0.16 },
  ];
  drawTableHeaderRow(doc, columns);

  for (const row of rows) {
    const cells = [
      `${row.requirementSlNo}. ${row.requirementTitle}`,
      row.remarks ?? "",
      row.actionRequired ?? "",
      ratingLabel(row.complianceAssessment),
    ];
    drawRow(doc, cells, columns, { colorIndex: 3, color: row.complianceAssessment ? RATING_COLOR[row.complianceAssessment] : undefined });
  }
}

/**
 * Assessment area | Key Questions | Assessment | Remarks | Actions
 * required for closure | Compliance — grouped by area, with the
 * area-level rating shown on the first row of each group (this
 * prompt). "Key Questions"/"Assessment" render from
 * assessment_answers when a question bank exists for the area; today
 * none is seeded, so every area is a single-row group carrying its own
 * rating — see docs/decisions.md.
 */
function drawAccommodationTable(doc: PDFKit.PDFDocument, groups: AccommodationAreaGroup[]): void {
  const columns: ColumnSpec[] = [
    { label: "Assessment area", width: CONTENT_WIDTH * 0.16 },
    { label: "Key Questions", width: CONTENT_WIDTH * 0.22 },
    { label: "Assessment", width: CONTENT_WIDTH * 0.12 },
    { label: "Remarks", width: CONTENT_WIDTH * 0.2 },
    { label: "Actions required for closure", width: CONTENT_WIDTH * 0.16 },
    { label: "Compliance", width: CONTENT_WIDTH * 0.14 },
  ];
  drawTableHeaderRow(doc, columns);

  for (const group of groups) {
    const subRows = group.keyQuestions.length > 0 ? group.keyQuestions : [null];
    subRows.forEach((question, index) => {
      const isFirst = index === 0;
      const cells = [
        isFirst ? `${group.areaSlNo}. ${group.areaTitle}` : "",
        question?.questionText ?? "",
        question?.answer ?? "",
        isFirst ? (group.areaRemarks ?? "") : (question?.remark ?? ""),
        isFirst ? (group.areaActionRequired ?? "") : "",
        isFirst ? ratingLabel(group.areaRating) : "",
      ];
      drawRow(doc, cells, columns, {
        colorIndex: 5,
        color: isFirst && group.areaRating ? RATING_COLOR[group.areaRating] : undefined,
      });
    });
  }
}

/** Photo appendix, captioned and referenced to the area (this prompt). */
function drawPhotoAppendix(doc: PDFKit.PDFDocument, photos: { photo: ReportPhoto; bytes: Uint8Array }[]): void {
  doc.addPage({ size: PAGE.size, margin: PAGE.margin });
  doc.fontSize(14).fillColor(COLORS.ink).text("Photograph appendix", PAGE.margin, PAGE.margin);
  doc.y = PAGE.margin + 30;

  const imageWidth = CONTENT_WIDTH;
  const imageHeight = 260;
  const blockHeight = imageHeight + 36;

  for (const { photo, bytes } of photos) {
    ensureSpace(doc, blockHeight);
    const y = doc.y;
    doc.image(Buffer.from(bytes), PAGE.margin, y, { fit: [imageWidth, imageHeight] });
    const captionY = y + imageHeight + 6;
    const areaLabel = photo.areaSlNo !== null ? `${photo.areaSlNo}. ${photo.areaTitle ?? ""}` : "Uncategorised";
    doc.fontSize(9).fillColor(COLORS.ink).text(`${areaLabel} — ${photo.caption ?? "No caption"}`, PAGE.margin, captionY, { width: CONTENT_WIDTH });
    doc.y = captionY + 24;
  }
}

/** Page numbering, generated date, subject code in the footer (this prompt) — on every page. */
function drawFooters(doc: PDFKit.PDFDocument, snapshot: ReportSnapshot): void {
  const range = doc.bufferedPageRange();
  const total = range.start + range.count;
  for (let i = range.start; i < total; i++) {
    doc.switchToPage(i);
    const y = PAGE_BOTTOM + 10;
    doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_WIDTH, y).strokeColor(COLORS.hairline).stroke();
    doc
      .fontSize(7)
      .fillColor(COLORS.inkSecondary)
      .text(snapshot.header.subjectCode, PAGE.margin, y + 6, { width: CONTENT_WIDTH / 3, lineBreak: false })
      .text(`Generated ${fmtDate(snapshot.header.generatedAt)}`, PAGE.margin + CONTENT_WIDTH / 3, y + 6, {
        width: CONTENT_WIDTH / 3,
        align: "center",
        lineBreak: false,
      })
      .text(`Page ${i - range.start + 1} of ${total}`, PAGE.margin + (CONTENT_WIDTH * 2) / 3, y + 6, {
        width: CONTENT_WIDTH / 3,
        align: "right",
        lineBreak: false,
      });
  }
}
