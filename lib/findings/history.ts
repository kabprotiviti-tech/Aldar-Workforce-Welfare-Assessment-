import type { FindingStatus } from "@/lib/db/findings";

/**
 * Cross-cycle view per entity and per requirement (this prompt: "raised,
 * actioned, closed, recurred"). The five real status values collapse to
 * three outcome labels for this coarse view — "actioned" covers every
 * in-between state, since what this view is for is seeing at a glance
 * whether each cycle's finding got resolved, not re-deriving its exact
 * stage (the detail drawer already shows that). "Recurred" is a
 * separate, orthogonal flag: whether this finding is itself a repeat of
 * one closed earlier (repeat_of_finding_id), which can be true alongside
 * any of the three outcomes.
 */
export type FindingOutcome = "raised" | "actioned" | "closed";

export function outcomeForStatus(status: FindingStatus): FindingOutcome {
  if (status === "open") return "raised";
  if (status === "closed") return "closed";
  return "actioned";
}

export interface FindingHistoryInput {
  id: string;
  createdAt: string;
  status: FindingStatus;
  repeatOfFindingId: string | null;
}

export interface FindingHistoryEntry extends FindingHistoryInput {
  outcome: FindingOutcome;
  isRecurrence: boolean;
}

/** Oldest first — a cross-cycle timeline reads as history, not a most-recent-first list. */
export function buildFindingHistory(findings: readonly FindingHistoryInput[]): FindingHistoryEntry[] {
  return [...findings]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((finding) => ({
      ...finding,
      outcome: outcomeForStatus(finding.status),
      isRecurrence: finding.repeatOfFindingId !== null,
    }));
}
