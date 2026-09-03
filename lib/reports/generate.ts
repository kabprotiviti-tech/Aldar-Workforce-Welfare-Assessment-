import { buildReportSnapshot, type ReportHeader, type ReportSnapshot } from "@/lib/reports/snapshot";

export interface ReportSourceItem {
  requirementSlNo: number;
  requirementTitle: string;
  remarks: string | null;
  actionRequired: string | null;
  complianceStatus: ReportSnapshot["rows"][number]["complianceAssessment"];
  wasAssessed: boolean;
}

/**
 * The port report generation runs over — same reasoning as every other
 * ports-and-adapters split in this codebase (e.g. lib/rfi/portal.ts):
 * isolating the Storage/RPC calls behind an interface lets the
 * orchestration (which fields go where) be proven without live
 * Supabase Storage.
 */
export interface ReportGenerationDb {
  loadHeaderAndItems(assessmentId: string): Promise<{ header: ReportHeader; items: readonly ReportSourceItem[] }>;
  /** Uploads the snapshot's bytes to Storage, returning the path they were stored at. */
  uploadSnapshotFile(assessmentId: string, version: number, bytes: Uint8Array): Promise<{ storagePath: string }>;
  /** Calls approve_assessment_and_generate_report — the atomic database side (locks items, inserts the reports row). */
  approveAndInsertReport(assessmentId: string, storagePath: string, snapshot: ReportSnapshot): Promise<{ reportId: string }>;
}

export interface GenerateReportResult {
  reportId: string;
  snapshot: ReportSnapshot;
}

/**
 * Client approval, end to end (this prompt: "on client approval, the
 * assessment and all its items lock: immutable, with a report version
 * generated"). The snapshot is built and uploaded *before* the atomic
 * database step, so p_snapshot/p_storage_path are ready the moment
 * approve_assessment_and_generate_report needs them — approval itself
 * is one database transaction (0030_governance.sql), but the Storage
 * upload that precedes it isn't part of that transaction (Storage and
 * Postgres can't share one), the same trade-off every other
 * upload-then-record flow in this codebase already accepts.
 */
export async function generateAndApproveReport(db: ReportGenerationDb, assessmentId: string): Promise<GenerateReportResult> {
  const { header, items } = await db.loadHeaderAndItems(assessmentId);
  const snapshot = buildReportSnapshot({
    header,
    items: items.map((item) => ({
      requirementSlNo: item.requirementSlNo,
      requirementTitle: item.requirementTitle,
      remarks: item.remarks,
      actionRequired: item.actionRequired,
      complianceStatus: item.complianceStatus,
      wasAssessed: item.wasAssessed,
    })),
  });

  const bytes = new TextEncoder().encode(JSON.stringify(snapshot, null, 2));
  const { storagePath } = await db.uploadSnapshotFile(assessmentId, header.version, bytes);
  const { reportId } = await db.approveAndInsertReport(assessmentId, storagePath, snapshot);

  return { reportId, snapshot };
}
