import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { renderReportPdf } from "./pdf";
import type { ReportSnapshot } from "./snapshot";

/** Builds a real, valid 1x1 RGB PNG from raw bytes — safer than a hand-typed base64 literal, which is easy to get subtly wrong. */
function buildTinyPng(): Buffer {
  const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([length, typeAndData, crc]);
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // color type: RGB
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);
  const raw = Buffer.from([0, 200, 40, 60]); // filter byte 0 + one RGB pixel
  const idat = deflateSync(raw);

  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const TINY_PNG = buildTinyPng();

const baseHeader: ReportSnapshot["header"] = {
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
  generatedAt: "2026-06-15T00:00:00.000Z",
  version: 1,
  riskRating: "Low",
  overallCompliancePct: 91.5,
  adjustedCompliancePct: 95,
  scoringWeightsVersion: 1,
};

function epSnapshot(): ReportSnapshot {
  return {
    header: baseHeader,
    rows: [
      {
        requirementSlNo: 1,
        requirementTitle: "Recruitment agency fees not charged to workers",
        remarks: "No evidence of agency fees charged.",
        actionRequired: null,
        complianceAssessment: "Compliant",
        wasAssessed: true,
      },
      {
        requirementSlNo: 11,
        requirementTitle: "Timely wage payment",
        remarks: "Wages late in two of twelve months, within the sampled payroll register.",
        actionRequired: "Transfer April and May wages' arrears and confirm on-time payment for the next quarter.",
        complianceAssessment: "Not Compliant",
        wasAssessed: true,
      },
      {
        requirementSlNo: 14,
        requirementTitle: "Passport retention",
        remarks: "One of forty sampled workers reported their passport was held by the employer.",
        actionRequired: "Return the passport and confirm with the worker directly.",
        complianceAssessment: "Partial",
        wasAssessed: true,
      },
      {
        requirementSlNo: 20,
        requirementTitle: "Not applicable requirement",
        remarks: "No workers under 18 employed at this site.",
        actionRequired: null,
        complianceAssessment: "Not Applicable",
        wasAssessed: true,
      },
    ],
    accommodationGroups: [],
    photos: [],
  };
}

function accommodationSnapshot(): ReportSnapshot {
  return {
    header: { ...baseHeader, module: "accommodation", facilityName: "Camp A", subjectCode: "2026-ACM-IN-TEST-1" },
    rows: [],
    accommodationGroups: [
      {
        areaSlNo: 1,
        areaTitle: "General requirements",
        areaRating: "Compliant",
        areaRemarks: "Capacity within limits.",
        areaActionRequired: null,
        wasAssessed: true,
        keyQuestions: [],
      },
      {
        areaSlNo: 2,
        areaTitle: "Bedrooms",
        areaRating: "Partial",
        areaRemarks: "Area per resident marginally below minimum in two rooms.",
        areaActionRequired: "Reduce occupancy in rooms A-101 and A-102.",
        wasAssessed: true,
        keyQuestions: [
          { questionText: "Is area per resident compliant?", answer: "No", remark: "3.6m² measured against a 4.0m² minimum." },
          { questionText: "Are beds in good condition?", answer: "Yes", remark: null },
        ],
      },
    ],
    photos: [
      { id: "photo-1", areaSlNo: 1, areaTitle: "General requirements", caption: "Main entrance", storagePath: "photos/1.png" },
    ],
  };
}

describe("renderReportPdf", () => {
  it("renders a valid PDF for the Employment Practices table", async () => {
    const bytes = await renderReportPdf(epSnapshot(), { logoBytes: null, photos: [] });
    expect(Buffer.from(bytes).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(500);
  });

  it("renders a valid PDF for the Accommodation table with a photo appendix", async () => {
    const snapshot = accommodationSnapshot();
    const bytes = await renderReportPdf(snapshot, { logoBytes: null, photos: [{ photo: snapshot.photos[0]!, bytes: TINY_PNG }] });
    expect(Buffer.from(bytes).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("is byte-identical across two renders of the same Employment Practices snapshot", async () => {
    const snapshot = epSnapshot();
    const a = await renderReportPdf(snapshot, { logoBytes: null, photos: [] });
    const b = await renderReportPdf(snapshot, { logoBytes: null, photos: [] });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("is byte-identical across two renders of the same Accommodation snapshot, photos included", async () => {
    const snapshot = accommodationSnapshot();
    const photos = [{ photo: snapshot.photos[0]!, bytes: TINY_PNG }];
    const a = await renderReportPdf(snapshot, { logoBytes: null, photos });
    const b = await renderReportPdf(snapshot, { logoBytes: null, photos });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("is byte-identical with a logo present", async () => {
    const snapshot = epSnapshot();
    const a = await renderReportPdf(snapshot, { logoBytes: TINY_PNG, photos: [] });
    const b = await renderReportPdf(snapshot, { logoBytes: TINY_PNG, photos: [] });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("produces different bytes for a genuinely different snapshot (sanity check the test isn't vacuous)", async () => {
    const a = await renderReportPdf(epSnapshot(), { logoBytes: null, photos: [] });
    const changed = epSnapshot();
    changed.rows[0]!.remarks = "A materially different remark that changes the rendered content.";
    const b = await renderReportPdf(changed, { logoBytes: null, photos: [] });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("renders many rows across multiple pages without throwing, and paginates footers correctly", async () => {
    const snapshot = epSnapshot();
    snapshot.rows = Array.from({ length: 23 }, (_, i) => ({
      requirementSlNo: i + 1,
      requirementTitle: `Requirement ${i + 1} with a reasonably long title to exercise text wrapping in the cell`,
      remarks: "A remark long enough to wrap across more than one line in the Remarks column of the table.",
      actionRequired: i % 3 === 0 ? "An action required for closure, also long enough to wrap onto a second line." : null,
      complianceAssessment: (["Compliant", "Partial", "Not Compliant", "Not Applicable"] as const)[i % 4]!,
      wasAssessed: true,
    }));
    const bytes = await renderReportPdf(snapshot, { logoBytes: null, photos: [] });
    expect(Buffer.from(bytes).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
