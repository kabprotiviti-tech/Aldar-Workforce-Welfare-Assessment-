import type { FindingReviewerDecision, FindingStatus } from "@/lib/db/findings";

/**
 * Finding lifecycle across cycles (this prompt). Pure throughout — no
 * database — so every transition and the two closing guarantees are
 * provable without one; 0029_finding_lifecycle.sql's triggers are the
 * database's own enforcement of the same rules, not a substitute for
 * checking them here first with a message a user can actually read.
 */

/**
 * The fixed vocabulary for finding_events.event_type — kept here rather
 * than as a database enum, the same "app boundary, not the column"
 * treatment as evidence_files.document_class, because unlike a status
 * column this is a append-only label, never branched on by SQL.
 */
export const FINDING_EVENT_TYPES = [
  "created",
  "owner_assigned",
  "started",
  "closure_submitted",
  "reviewer_accepted",
  "reviewer_rejected",
  "reopened",
  "escalated",
] as const;
export type FindingEventType = (typeof FINDING_EVENT_TYPES)[number];

/** Owner (or staff, on their behalf) beginning work — the only sanctioned "open" -> "in_progress" move. */
export function statusAfterWorkStarted(current: FindingStatus): FindingStatus {
  return current === "open" ? "in_progress" : current;
}

/**
 * The closure portal's one action: evidence plus a note, submitted
 * together (this prompt: "uploads closure evidence, adds a note"). Moves
 * straight to "under_review" — there's no meaningful distinct state
 * between "files attached" and "ready for a reviewer" from the owner's
 * side of the portal. "evidence_submitted" stays a valid status value
 * for a finding a staff member is still assembling evidence for
 * internally. See docs/decisions.md.
 */
export function statusAfterClosureSubmitted(): FindingStatus {
  return "under_review";
}

export function canSubmitClosureEvidence(status: FindingStatus): boolean {
  return status !== "closed";
}

export function canRecordReviewDecision(status: FindingStatus): boolean {
  return status === "under_review" || status === "evidence_submitted";
}

/**
 * "Accept closure, or reject with reason and a new due date. Partial
 * closure is explicitly not acceptance" (this prompt) — accepted is the
 * only decision that closes a finding; rejected sends it back to active
 * work, never anywhere that reads as "resolved."
 */
export function statusAfterReviewDecision(decision: FindingReviewerDecision): FindingStatus {
  return decision === "accepted" ? "closed" : "in_progress";
}

export interface ReviewDecisionInput {
  status: FindingStatus;
  decision: FindingReviewerDecision;
  hasClosureEvidence: boolean;
  reason: string | null;
  newDueDate: string | null;
}

export type ReviewDecisionValidation = { ok: true } | { ok: false; message: string };

/**
 * Validated here, before the write, so a reviewer sees this message
 * rather than 0029_finding_lifecycle.sql's own trigger error — the same
 * "validation runs here, but the database is what actually guarantees
 * it" split as lib/assessment/actions.ts's saveDecision. Both halves of
 * this prompt's acceptance criterion ("closing a finding requires
 * closure evidence and a reviewer decision; neither can be skipped") are
 * checked explicitly, not inferred from the trigger's success/failure.
 */
export function validateReviewDecision(input: ReviewDecisionInput): ReviewDecisionValidation {
  if (!canRecordReviewDecision(input.status)) {
    return { ok: false, message: "This finding has no closure submission awaiting a review decision yet." };
  }
  if (input.decision === "accepted" && !input.hasClosureEvidence) {
    return { ok: false, message: "A finding cannot be closed without closure evidence on record." };
  }
  if (input.decision === "rejected" && (!input.reason || !input.reason.trim())) {
    return { ok: false, message: "Rejecting a closure requires a reason." };
  }
  if (input.decision === "rejected" && !input.newDueDate) {
    return { ok: false, message: "Rejecting a closure requires a new due date." };
  }
  return { ok: true };
}

export function canReopen(status: FindingStatus): boolean {
  return status === "closed";
}
