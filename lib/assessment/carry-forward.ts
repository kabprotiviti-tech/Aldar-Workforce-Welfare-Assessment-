import type { ComplianceRating } from "@/lib/rules/constants";
import type { DbModule } from "@/lib/db/common";
import type { FindingStatus } from "@/lib/db/findings";

/**
 * Carry-forward from the previous assessment cycle (this prompt): what
 * makes the platform worth more than the current process is that a
 * requirement compliant last time doesn't have to be re-proven from
 * scratch — but a requirement that was failing, and hasn't been closed
 * out, cannot be waved through by inertia.
 *
 * Pure throughout — no database — so the eligibility rule and the exact
 * wording are provable without one. See docs/decisions.md.
 */

/**
 * The boilerplate this prompt requires verbatim from CONTEXT.md's
 * "Carry-forward boilerplate (use these strings verbatim)" section.
 * Kept as a constant, character for character, rather than assembled
 * from parts — assembling it invites a wording drift the literal
 * acceptance criterion exists to catch.
 *
 * Onboarding has no boilerplate text in CONTEXT.md, so carry-forward has
 * nothing to write for it yet; `boilerplateFor` returns null rather than
 * inventing wording CONTEXT.md never specified.
 */
export const CARRY_FORWARD_BOILERPLATE: Partial<Record<DbModule, { remarks: string; actionRequired: string }>> = {
  employment_practices: {
    remarks:
      "This section was not assessed as part of this review. Previous monitoring has identified the policies, procedures and their application relating to this section as compliant with Aldar's Worker Welfare Policy.",
    actionRequired: "N/A",
  },
  accommodation: {
    remarks:
      "This section was not assessed as part of this review. The last review has identified this section as compliant with Aldar's Accommodation Facility Checklist.",
    actionRequired: "N/A",
  },
};

export function boilerplateFor(module: DbModule): { remarks: string; actionRequired: string } | null {
  return CARRY_FORWARD_BOILERPLATE[module] ?? null;
}

/**
 * What's known about a finding tied to the item being carried forward.
 * "none" and "closed" are the two states that permit carry-forward;
 * "open" is the one this prompt says must block it, unconditionally,
 * regardless of what the recorded status was.
 */
export type PreviousFindingState = "none" | "open" | "closed";

export function previousFindingState(status: FindingStatus | null): PreviousFindingState {
  if (status === null) return "none";
  return status === "closed" ? "closed" : "open";
}

export interface CarryForwardEligibility {
  eligible: boolean;
  /** Why not, for the explanatory message this prompt's acceptance criterion requires. Null when eligible. */
  reason: string | null;
}

/**
 * This prompt, read literally: "Carry-forward is only permitted where
 * the previous status was Compliant, or where a finding was formally
 * closed. A previously Partial or Not Compliant item with an open
 * finding CANNOT be carried forward and must be assessed."
 *
 * Not Applicable is treated the same as Compliant — no compliance gap
 * to have closed, so nothing blocks it either — a deliberate inclusion
 * beyond CONTEXT.md's literal two categories, documented in
 * docs/decisions.md. Every other combination (no previous status at
 * all, or a Partial/Not Compliant item with no finding on record) is
 * not eligible: the point of the rule is that carry-forward stands in
 * for a genuine "we already resolved this", not "nobody checked".
 */
export function checkCarryForwardEligibility(previousStatus: ComplianceRating | null, findingState: PreviousFindingState): CarryForwardEligibility {
  if (previousStatus === null) {
    return { eligible: false, reason: "This requirement has no previous cycle to carry forward from." };
  }

  if (findingState === "open") {
    return {
      eligible: false,
      reason: `This requirement has an open finding from the previous cycle. It cannot be carried forward and must be assessed this cycle.`,
    };
  }

  if (previousStatus === "Compliant" || previousStatus === "Not Applicable") {
    return { eligible: true, reason: null };
  }

  // Partial or Not Compliant: eligible only once the finding tracking it
  // has been formally closed — never merely because none was recorded.
  if (findingState === "closed") {
    return { eligible: true, reason: null };
  }

  return {
    eligible: false,
    reason: `This requirement was previously rated ${previousStatus} and has not been formally closed out. It must be assessed this cycle.`,
  };
}

export interface CarriedForwardDecision {
  status: ComplianceRating;
  remarks: string;
  actionRequired: string;
}

export type PlanCarryForwardResult = { ok: true; decision: CarriedForwardDecision } | { ok: false; message: string };

/**
 * What "not assessed this cycle" actually writes, once eligibility has
 * been checked: the previous status, inherited verbatim (this prompt:
 * "Compliance Assessment: (inherited from previous audit)"), and the
 * exact boilerplate remark and closure action for this module.
 */
export function planCarryForwardDecision(module: DbModule, previousStatus: ComplianceRating | null, findingState: PreviousFindingState): PlanCarryForwardResult {
  const eligibility = checkCarryForwardEligibility(previousStatus, findingState);
  if (!eligibility.eligible) {
    return { ok: false, message: eligibility.reason! };
  }

  const boilerplate = boilerplateFor(module);
  if (!boilerplate) {
    return { ok: false, message: "There is no carry-forward wording defined for this module yet." };
  }

  return { ok: true, decision: { status: previousStatus!, remarks: boilerplate.remarks, actionRequired: boilerplate.actionRequired } };
}

export interface RepeatDetectionResult {
  isRepeat: boolean;
  /** Set only when isRepeat — the previously closed finding this one repeats. */
  repeatOfFindingId: string | null;
}

/**
 * "If an item was closed in a previous cycle and fails again, flag
 * repeat_of_finding_id and mark it as a repeat finding" (this prompt).
 * A fresh failure against a finding that was never closed (still open,
 * or none exists) is not a repeat — it's the same unresolved issue
 * continuing, which is a different thing from a resolved issue coming
 * back.
 */
export function detectRepeat(newStatus: ComplianceRating, previousFindingId: string | null, previousFindingStatus: FindingStatus | null): RepeatDetectionResult {
  const failed = newStatus === "Partial" || newStatus === "Not Compliant";
  const wasClosed = previousFindingId !== null && previousFindingStatus === "closed";

  if (failed && wasClosed) {
    return { isRepeat: true, repeatOfFindingId: previousFindingId };
  }
  return { isRepeat: false, repeatOfFindingId: null };
}

/** The snapshot written onto a newly generated assessment_item, when a previous cycle's item exists for the same requirement. */
export interface PreviousItemSnapshot {
  previousComplianceStatus: ComplianceRating | null;
  previousRemarks: string | null;
  previousActionRequired: string | null;
  carriedForwardFromItemId: string | null;
}

export const NO_PREVIOUS_ITEM: PreviousItemSnapshot = {
  previousComplianceStatus: null,
  previousRemarks: null,
  previousActionRequired: null,
  carriedForwardFromItemId: null,
};

/** One row of the cycle diff view: previous cycle status beside this cycle's, for one requirement (this prompt). */
export interface CycleDiffRow {
  requirementSlNo: number;
  requirementTitle: string;
  previousStatus: ComplianceRating | null;
  currentStatus: ComplianceRating | null;
  wasAssessed: boolean;
}

export interface CycleDiffEntry extends CycleDiffRow {
  /** True whenever the two differ — including either side being null, which is itself a change worth seeing. */
  changed: boolean;
}

/** Sorted by requirement, with the changed flag computed once so the UI never has to re-derive it. */
export function buildCycleDiff(rows: readonly CycleDiffRow[]): CycleDiffEntry[] {
  return [...rows]
    .sort((a, b) => a.requirementSlNo - b.requirementSlNo)
    .map((row) => ({ ...row, changed: row.previousStatus !== row.currentStatus }));
}
