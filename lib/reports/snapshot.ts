import type { ComplianceRating, RiskRating } from "@/lib/rules/constants";
import type { DbModule } from "@/lib/db/common";

/**
 * A report's content, stored verbatim in reports.snapshot (0030_governance.sql)
 * and never recomputed after the fact — this is what makes "a revision
 * preserves... its data exactly" true of version n regardless of what
 * happens to the live assessment afterwards.
 *
 * Scoped to the fields this platform actually tracks. CONTEXT.md's
 * report header names several fields this schema has no source for at
 * all (Originator, Description, Type, Project Type, Project Name) and
 * the Accommodation table names a "Key Questions" column and a separate
 * "Assessment" narrative column distinct from Remarks — none of those
 * are backed by real stored data anywhere in this platform. Per
 * CONTEXT.md rule 7 ("never guess to fill a field"), they are omitted
 * here rather than invented; the header/rows below are the parts of
 * CONTEXT.md's report format this platform can populate honestly. See
 * docs/decisions.md.
 */

export interface ReportHeader {
  subjectCode: string;
  module: DbModule;
  assessmentType: "initial" | "follow_up";
  entityName: string;
  facilityName: string | null;
  auditNumber: number;
  actualVisitDate: string | null;
  generatedAt: string;
  version: number;
  riskRating: RiskRating | null;
  overallCompliancePct: number | null;
  adjustedCompliancePct: number | null;
}

export interface ReportRow {
  requirementSlNo: number;
  requirementTitle: string;
  remarks: string | null;
  actionRequired: string | null;
  complianceAssessment: ComplianceRating | null;
  wasAssessed: boolean;
}

export interface ReportSnapshot {
  header: ReportHeader;
  rows: ReportRow[];
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
}

/** Sorted by requirement/area number — the order the client's own report table reads in. */
export function buildReportSnapshot(input: BuildReportSnapshotInput): ReportSnapshot {
  const rows = [...input.items]
    .sort((a, b) => a.requirementSlNo - b.requirementSlNo)
    .map((item) => ({
      requirementSlNo: item.requirementSlNo,
      requirementTitle: item.requirementTitle,
      remarks: item.remarks,
      actionRequired: item.actionRequired,
      complianceAssessment: item.complianceStatus,
      wasAssessed: item.wasAssessed,
    }));

  return { header: input.header, rows };
}
