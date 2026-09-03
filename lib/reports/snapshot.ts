import type { ComplianceRating, QuestionAnswer, RiskRating } from "@/lib/rules/constants";
import type { DbModule } from "@/lib/db/common";

/**
 * A report's content, stored verbatim in reports.snapshot (0030_governance.sql)
 * and never recomputed after the fact — this is what makes "a revision
 * preserves... its data exactly" true of version n regardless of what
 * happens to the live assessment afterwards. `lib/reports/pdf.ts` renders
 * this exact structure into the PDF; nothing in the renderer queries the
 * database itself, so the same snapshot always produces the same PDF
 * bytes.
 *
 * CONTEXT.md's header block names a few fields this platform genuinely
 * has no source for — Description has no captured free-text field
 * anywhere. Per CONTEXT.md rule 7 ("never guess to fill a field") it's
 * left null rather than invented. Every other header field below *is*
 * backed by real stored data, including three that an earlier pass
 * wrongly treated as unavailable — see docs/decisions.md:
 * Originator <- assessments.created_by (resolved to a name), Project
 * Type <- the module's display name, Project Name <- the cycle's name.
 *
 * Photo bytes are never embedded in this jsonb — only a Storage
 * reference (`storagePath`) and its caption/area. The photo itself is
 * immutable at that path (every upload writes to a fresh, timestamped
 * path — nothing in this codebase ever overwrites one), and the
 * rendered PDF is what actually embeds the bytes; keeping binary
 * content out of this row is a deliberate size/architecture choice, not
 * a gap. See docs/decisions.md.
 */

export interface ReportHeader {
  subjectCode: string;
  originatorName: string | null;
  description: string | null;
  assessmentType: "initial" | "follow_up";
  module: DbModule;
  projectName: string | null;
  entityName: string;
  facilityName: string | null;
  auditNumber: number;
  isCurrent: boolean;
  reassessed: boolean;
  actualVisitDate: string | null;
  generatedAt: string;
  version: number;
  riskRating: RiskRating | null;
  overallCompliancePct: number | null;
  adjustedCompliancePct: number | null;
  /** Which scoring_weights version produced overallCompliancePct/adjustedCompliancePct — "record which was used on each report" (this prompt). */
  scoringWeightsVersion: number;
}

/** Employment Practices / Onboarding table row: one per Worker Welfare Requirement. */
export interface ReportRow {
  requirementSlNo: number;
  requirementTitle: string;
  remarks: string | null;
  actionRequired: string | null;
  complianceAssessment: ComplianceRating | null;
  wasAssessed: boolean;
}

/**
 * One key question within an Accommodation area, when the platform has a
 * question bank populated for it. Empty today (no question bank is
 * seeded yet — see docs/decisions.md); when empty, the area still
 * renders as a single-row group carrying the area's own rating/remarks/
 * action, the "group of one" case of "grouped by area with the
 * area-level rating on the first row of each group."
 */
export interface AccommodationKeyQuestion {
  questionText: string;
  answer: QuestionAnswer | null;
  remark: string | null;
}

/** Accommodation table group: one per checklist area, its own rating shown once on the first row. */
export interface AccommodationAreaGroup {
  areaSlNo: number;
  areaTitle: string;
  areaRating: ComplianceRating | null;
  areaRemarks: string | null;
  areaActionRequired: string | null;
  wasAssessed: boolean;
  keyQuestions: AccommodationKeyQuestion[];
}

/** One photo appendix entry, captioned and referenced to the area it documents. */
export interface ReportPhoto {
  id: string;
  areaSlNo: number | null;
  areaTitle: string | null;
  caption: string | null;
  storagePath: string;
}

export interface ReportSnapshot {
  header: ReportHeader;
  /** Populated for employment_practices/onboarding; empty for accommodation. */
  rows: ReportRow[];
  /** Populated for accommodation; empty for employment_practices/onboarding. */
  accommodationGroups: AccommodationAreaGroup[];
  /** Accommodation only. */
  photos: ReportPhoto[];
}

export interface BuildReportSnapshotInput {
  header: ReportHeader;
  items: readonly {
    requirementSlNo: number;
    requirementTitle: string;
    remarks: string | null;
    actionRequired: string | null;
    complianceStatus: ComplianceRating | null;
    wasAssessed: boolean;
  }[];
  accommodationItems: readonly {
    areaSlNo: number;
    areaTitle: string;
    areaRating: ComplianceRating | null;
    areaRemarks: string | null;
    areaActionRequired: string | null;
    wasAssessed: boolean;
    keyQuestions: readonly AccommodationKeyQuestion[];
  }[];
  photos: readonly ReportPhoto[];
}

/** Sorted by requirement/area number — the order the client's own report table reads in. */
export function buildReportSnapshot(input: BuildReportSnapshotInput): ReportSnapshot {
  const rows: ReportRow[] = [...input.items]
    .sort((a, b) => a.requirementSlNo - b.requirementSlNo)
    .map((item) => ({
      requirementSlNo: item.requirementSlNo,
      requirementTitle: item.requirementTitle,
      remarks: item.remarks,
      actionRequired: item.actionRequired,
      complianceAssessment: item.complianceStatus,
      wasAssessed: item.wasAssessed,
    }));

  const accommodationGroups: AccommodationAreaGroup[] = [...input.accommodationItems]
    .sort((a, b) => a.areaSlNo - b.areaSlNo)
    .map((item) => ({
      areaSlNo: item.areaSlNo,
      areaTitle: item.areaTitle,
      areaRating: item.areaRating,
      areaRemarks: item.areaRemarks,
      areaActionRequired: item.areaActionRequired,
      wasAssessed: item.wasAssessed,
      keyQuestions: [...item.keyQuestions],
    }));

  const photos = [...input.photos].sort((a, b) => (a.areaSlNo ?? 0) - (b.areaSlNo ?? 0));

  return { header: input.header, rows, accommodationGroups, photos };
}
