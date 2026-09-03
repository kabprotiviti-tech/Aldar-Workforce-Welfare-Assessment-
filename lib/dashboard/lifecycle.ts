/**
 * The 8-stage lifecycle rail (this prompt), using `assessments.stage`'s
 * own vocabulary (`0004_assessments.sql`'s check constraint) — but
 * *derived* here from real, separately-stored signals rather than read
 * from that column, because nothing in this codebase ever writes to it
 * (confirmed by survey before this phase started). Reading a column
 * nothing writes would show every assessment permanently stuck at
 * 'plan', which is worse than not having a rail at all. Every branch
 * below is driven by a fact this schema actually stores; see
 * docs/decisions.md for why the column itself isn't used and what a
 * real fix would look like.
 */

export const LIFECYCLE_STAGES = ["plan", "request", "collect", "review", "assess", "report", "act", "monitor"] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export interface LifecycleSignals {
  assessmentId: string;
  hasIssuedRfi: boolean;
  hasOpenRfi: boolean;
  confirmedVisitDate: string | null;
  actualVisitDate: string | null;
  totalItems: number;
  decidedItems: number;
  issuedAt: string | null;
  openFindingsCount: number;
}

/**
 * One assessment's derived stage. Evaluated most-advanced-condition
 * first, each guarded by a real stored fact:
 * - issued (approved + released to the client) -> act/monitor, split by
 *   whether any of its findings are still open.
 * - every requirement decided, but not yet issued -> report (QA,
 *   approval and issuance are all folded into this one bucket — this
 *   schema's 8-stage vocabulary has no separate slot for them, matching
 *   CONTEXT.md's own report-stage granularity).
 * - the office visit actually happened, decisions still in progress ->
 *   assess.
 * - a visit date is confirmed but hasn't happened yet -> review (desktop
 *   review ahead of the visit — the one real signal this schema
 *   captures for "review", 0004_assessments.sql/docs/schema.md's own
 *   distinction from qa_status's review).
 * - every issued RFI is resolved (none still open), visit not yet
 *   confirmed -> collect.
 * - an RFI is open -> request.
 * - nothing has happened yet -> plan.
 */
export function deriveLifecycleStage(input: Omit<LifecycleSignals, "assessmentId">): LifecycleStage {
  if (input.issuedAt) {
    return input.openFindingsCount > 0 ? "act" : "monitor";
  }
  if (input.totalItems > 0 && input.decidedItems >= input.totalItems) {
    return "report";
  }
  if (input.actualVisitDate) {
    return "assess";
  }
  if (input.confirmedVisitDate) {
    return "review";
  }
  if (input.hasIssuedRfi && !input.hasOpenRfi) {
    return "collect";
  }
  if (input.hasOpenRfi) {
    return "request";
  }
  return "plan";
}

export interface StageCount {
  stage: LifecycleStage;
  count: number;
  assessmentIds: string[];
}

/** Every assessment tagged with its derived stage, grouped for the rail — each count carries the exact assessment ids behind it, so "live counts" stay drillable to real rows, never an opaque number. */
export function groupByLifecycleStage(signals: readonly LifecycleSignals[]): StageCount[] {
  const byStage = new Map<LifecycleStage, string[]>(LIFECYCLE_STAGES.map((stage) => [stage, []]));
  for (const entry of signals) {
    const stage = deriveLifecycleStage(entry);
    byStage.get(stage)!.push(entry.assessmentId);
  }
  return LIFECYCLE_STAGES.map((stage) => ({ stage, count: byStage.get(stage)!.length, assessmentIds: byStage.get(stage)! }));
}
