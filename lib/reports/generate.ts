import { buildReportSnapshot, type AccommodationKeyQuestion, type ReportHeader, type ReportPhoto, type ReportSnapshot } from "@/lib/reports/snapshot";
import { computeComplianceAdjustedForNotAssessedPercent, computeOverallCompliancePercent, computeRiskRating, type ScoringWeights } from "@/lib/rules/aggregate";
import { renderReportPdf } from "@/lib/reports/pdf";
import type { ComplianceRating, RiskRating } from "@/lib/rules/constants";
import type { DbModule } from "@/lib/db/common";

export interface ReportSourceItem {
  requirementSlNo: number;
  requirementTitle: string;
  remarks: string | null;
  actionRequired: string | null;
  complianceStatus: ComplianceRating | null;
  wasAssessed: boolean;
}

export interface ReportSourceAccommodationItem {
  areaSlNo: number;
  areaTitle: string;
  areaRating: ComplianceRating | null;
  areaRemarks: string | null;
  areaActionRequired: string | null;
  wasAssessed: boolean;
  keyQuestions: AccommodationKeyQuestion[];
}

export interface ReportDataSource {
  subjectCode: string;
  originatorName: string | null;
  assessmentType: "initial" | "follow_up";
  module: DbModule;
  projectName: string | null;
  entityName: string;
  facilityName: string | null;
  auditNumber: number;
  actualVisitDate: string | null;
  /** Becomes the report's version — this platform's revision_number, not recomputed. */
  revisionNumber: number;
  items: ReportSourceItem[];
  accommodationItems: ReportSourceAccommodationItem[];
  photos: ReportPhoto[];
  photoBytes: (storagePath: string) => Promise<Uint8Array | null>;
  logoBytes: Uint8Array | null;
}

export interface ActiveScoringWeights {
  id: string;
  version: number;
  weights: ScoringWeights;
}

/**
 * The port report generation runs over — same reasoning as every other
 * ports-and-adapters split in this codebase (e.g. lib/rfi/portal.ts):
 * isolating the Storage/RPC calls behind an interface lets the
 * orchestration (which fields go where, how the percentages get
 * computed) be proven without live Supabase Storage.
 */
export interface ReportGenerationDb {
  loadReportData(assessmentId: string): Promise<ReportDataSource>;
  loadActiveScoringWeights(): Promise<ActiveScoringWeights>;
  /** Uploads the rendered PDF's bytes to Storage, returning the path they were stored at. */
  uploadReportFile(assessmentId: string, version: number, bytes: Uint8Array): Promise<{ storagePath: string }>;
  /** Calls approve_assessment_and_generate_report — the atomic database side (locks items, stamps Risk/Overall/Adjusted, inserts the reports row). */
  approveAndInsertReport(input: {
    assessmentId: string;
    storagePath: string;
    snapshot: ReportSnapshot;
    scoringWeightsId: string;
    riskRating: RiskRating | null;
    overallCompliancePct: number | null;
    adjustedCompliancePct: number | null;
  }): Promise<{ reportId: string }>;
}

export interface GenerateReportResult {
  reportId: string;
  snapshot: ReportSnapshot;
}

function asRatedEntities(
  items: readonly { rating: ComplianceRating | null; assessedThisCycle: boolean }[],
): { rating: ComplianceRating; remark: null; actionRequiredForClosure: null; assessedThisCycle: boolean }[] {
  return items
    .filter((item): item is { rating: ComplianceRating; assessedThisCycle: boolean } => item.rating !== null)
    .map((item) => ({ rating: item.rating, remark: null, actionRequiredForClosure: null, assessedThisCycle: item.assessedThisCycle }));
}

/**
 * Client approval, end to end (this prompt: "on client approval, the
 * assessment and all its items lock: immutable, with a report version
 * generated" — and this prompt's own "Report PDF" spec). The PDF is
 * rendered and uploaded *before* the atomic database step, so
 * p_snapshot/p_storage_path are ready the moment
 * approve_assessment_and_generate_report needs them.
 *
 * Risk/Overall/Adjusted are computed here, not read from a stale
 * column — lib/rules/aggregate.ts is the only thing in this codebase
 * allowed to do that arithmetic, and it runs against the exact items
 * this report is about, under the scoring weights active right now
 * (whose id/version is stamped onto the report so "which weights
 * produced this percentage" is never ambiguous later).
 *
 * Accommodation has no key requirements (lib/rules/aggregate.ts's own
 * comment), so risk rating is never computed for it — an Accommodation
 * area's sl_no (1-12) overlaps numerically with Employment Practices'
 * key requirement numbers, and calling computeRiskRating on
 * Accommodation items would silently misread an unrelated area as a
 * "key requirement." See docs/decisions.md.
 */
export async function generateAndApproveReport(db: ReportGenerationDb, assessmentId: string): Promise<GenerateReportResult> {
  const [source, activeWeights] = await Promise.all([db.loadReportData(assessmentId), db.loadActiveScoringWeights()]);
  const isAccommodation = source.module === "accommodation";

  const ratedEntities = isAccommodation
    ? asRatedEntities(source.accommodationItems.map((item) => ({ rating: item.areaRating, assessedThisCycle: item.wasAssessed })))
    : asRatedEntities(source.items.map((item) => ({ rating: item.complianceStatus, assessedThisCycle: item.wasAssessed })));

  const overallCompliancePct = computeOverallCompliancePercent(ratedEntities, activeWeights.weights);
  const adjustedCompliancePct = computeComplianceAdjustedForNotAssessedPercent(ratedEntities, activeWeights.weights);
  const riskRating = isAccommodation
    ? null
    : computeRiskRating(
        source.items
          .filter((item): item is ReportSourceItem & { complianceStatus: ComplianceRating } => item.complianceStatus !== null)
          .map((item) => ({
            requirementNumber: item.requirementSlNo,
            rating: item.complianceStatus,
            remark: null,
            actionRequiredForClosure: null,
            assessedThisCycle: item.wasAssessed,
          })),
      );

  const header: ReportHeader = {
    subjectCode: source.subjectCode,
    originatorName: source.originatorName,
    description: null,
    assessmentType: source.assessmentType,
    module: source.module,
    projectName: source.projectName,
    entityName: source.entityName,
    facilityName: source.facilityName,
    auditNumber: source.auditNumber,
    isCurrent: true,
    reassessed: source.assessmentType === "follow_up",
    actualVisitDate: source.actualVisitDate,
    generatedAt: new Date().toISOString(),
    version: source.revisionNumber,
    riskRating,
    overallCompliancePct,
    adjustedCompliancePct,
    scoringWeightsVersion: activeWeights.version,
  };

  const snapshot = buildReportSnapshot({
    header,
    items: source.items,
    accommodationItems: source.accommodationItems,
    photos: source.photos,
  });

  const photoImages = await Promise.all(
    snapshot.photos.map(async (photo) => ({ photo, bytes: await source.photoBytes(photo.storagePath) })),
  );

  const pdfBytes = await renderReportPdf(snapshot, {
    logoBytes: source.logoBytes,
    photos: photoImages.filter((p): p is { photo: typeof photoImages[number]["photo"]; bytes: Uint8Array } => p.bytes !== null),
  });

  const { storagePath } = await db.uploadReportFile(assessmentId, header.version, pdfBytes);
  const { reportId } = await db.approveAndInsertReport({
    assessmentId,
    storagePath,
    snapshot,
    scoringWeightsId: activeWeights.id,
    riskRating,
    overallCompliancePct,
    adjustedCompliancePct,
  });

  return { reportId, snapshot };
}
