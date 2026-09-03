/**
 * "Assessment status timeline visible on the assessment header" (this
 * prompt). Pure — merges the assessment's own milestone timestamps with
 * its revision history into one chronological list; no database access
 * of its own, so lib/qa/timeline-supabase.ts (or the page fetching this
 * data directly) only has to gather rows, never decide ordering or
 * labelling.
 */

export type TimelineEventKind = "created" | "qa_passed" | "approved" | "issued" | "revision_opened";

export interface TimelineEvent {
  kind: TimelineEventKind;
  at: string;
  label: string;
  detail: string | null;
}

export interface AssessmentTimelineInput {
  createdAt: string;
  qaCompletedAt: string | null;
  approvedAt: string | null;
  issuedAt: string | null;
  revisions: readonly { revisionNumber: number; reason: string; revisedAt: string }[];
}

/**
 * issued_at and approved_at land on the same instant for a first
 * approval (0030_governance.sql's approve_assessment_and_generate_report
 * sets both together) — both are still surfaced as distinct timeline
 * entries, since "approved" and "issued to the client" are different
 * facts even when they happen to coincide the first time.
 */
export function buildAssessmentTimeline(input: AssessmentTimelineInput): TimelineEvent[] {
  const events: TimelineEvent[] = [{ kind: "created", at: input.createdAt, label: "Assessment created", detail: null }];

  if (input.qaCompletedAt) {
    events.push({ kind: "qa_passed", at: input.qaCompletedAt, label: "QA passed", detail: null });
  }
  if (input.approvedAt) {
    events.push({ kind: "approved", at: input.approvedAt, label: "Approved", detail: null });
  }
  if (input.issuedAt) {
    events.push({ kind: "issued", at: input.issuedAt, label: "Issued to client", detail: null });
  }
  for (const revision of input.revisions) {
    events.push({ kind: "revision_opened", at: revision.revisedAt, label: `Revision ${revision.revisionNumber} opened`, detail: revision.reason });
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}
