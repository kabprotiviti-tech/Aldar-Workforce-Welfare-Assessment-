import type { ApprovalStatus, QaStatus } from "@/lib/db/assessments";

/**
 * QA and approval state machine (this prompt): "QA reviewer role opens
 * the assessment in review mode, raises queries against specific
 * requirements, and returns it to the assessor or passes it. On QA
 * pass, the assessment moves to client approval. On client approval,
 * the assessment... lock[s]."
 *
 * Pure throughout, validated here before ever touching the database —
 * 0030_governance.sql's triggers are the actual guarantee (a query left
 * open really does block a pass; approval really is unreachable without
 * a pass), the same "validate here for the message, the database for
 * the guarantee" split as every other write path in this codebase.
 */

export type QaValidation = { ok: true } | { ok: false; message: string };

/** not_started -> in_review (first open), or returned -> in_review (assessor is ready for another look). */
export function validateOpenReview(current: QaStatus): QaValidation {
  if (current !== "not_started" && current !== "returned") {
    return { ok: false, message: "This assessment is already under review or has already passed." };
  }
  return { ok: true };
}

/** in_review -> returned. Returning without at least one open query would send the assessor back with nothing to act on. */
export function validateReturnToAssessor(current: QaStatus, openQueryCount: number): QaValidation {
  if (current !== "in_review") {
    return { ok: false, message: "Open the review before returning it to the assessor." };
  }
  if (openQueryCount < 1) {
    return { ok: false, message: "Raise at least one query before returning this assessment to the assessor." };
  }
  return { ok: true };
}

/** in_review -> passed. Both the automated checklist and every raised query have to clear — this is the QA reviewer's actual sign-off. */
export function validatePassReview(current: QaStatus, openQueryCount: number, checklistPasses: boolean): QaValidation {
  if (current !== "in_review") {
    return { ok: false, message: "Open the review before passing it." };
  }
  if (openQueryCount > 0) {
    return { ok: false, message: "Resolve every open query before passing QA." };
  }
  if (!checklistPasses) {
    return { ok: false, message: "The automated QA checklist has not passed yet." };
  }
  return { ok: true };
}

/** awaiting_client -> approved. The formal act of client approval — only reachable once QA has passed. */
export function validateApprove(current: ApprovalStatus): QaValidation {
  if (current !== "awaiting_client") {
    return { ok: false, message: "This assessment is not awaiting client approval." };
  }
  return { ok: true };
}

/** approved -> pending, opening version n+1. A revision needs a stated reason — this is a formal act, not a quiet edit. */
export function validateOpenRevision(current: ApprovalStatus, reason: string): QaValidation {
  if (current !== "approved") {
    return { ok: false, message: "Only an approved assessment can be revised." };
  }
  if (!reason.trim()) {
    return { ok: false, message: "A revision needs a reason." };
  }
  return { ok: true };
}
