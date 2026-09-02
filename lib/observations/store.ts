import type { AiObservationKind, AiObservationStatus } from "@/lib/db/evidence";

/**
 * The observation vocabulary the UI and the workspace share, kept pure
 * and free of any client so both the panel and the tests can use it.
 */

/**
 * Which observations reach the assessor workspace for a requirement
 * (this prompt: "confirmed observations appear in the assessor workspace
 * for that requirement. Rejected ones do not").
 *
 * `open` is deliberately excluded as well: an unreviewed narrative is a
 * proposal, and the workspace is where the assessment is actually made.
 * The review panel in the evidence workspace is where `open` lives.
 */
export const WORKSPACE_OBSERVATION_STATUS: AiObservationStatus = "confirmed";

export function isVisibleInWorkspace(status: AiObservationStatus): boolean {
  return status === WORKSPACE_OBSERVATION_STATUS;
}

/** One observation as the review panel and the workspace both render it. */
export interface ObservationView {
  id: string;
  assessmentItemId: string;
  requirementId: string | null;
  kind: AiObservationKind;
  title: string;
  body: string | null;
  status: AiObservationStatus;
  sourceFactKeys: string[];
  pageRef: string | null;
  evidenceFileId: string | null;
  ruleCode: string | null;
  rejectionReason: string | null;
  authoredBy: "model" | "assessor";
  actionedAt: string | null;
}

export const OBSERVATION_KIND_LABELS: Record<AiObservationKind, string> = {
  evidence_identified: "Evidence identified",
  potential_gap: "Potential gap",
  requires_attention: "Requires attention",
};

/**
 * The notice this prompt requires to be permanently visible in the
 * panel, kept here as a constant so the panel, the workspace and the
 * tests all state it identically.
 */
export const OBSERVATION_NOTICE = "Observations require assessor validation. The platform does not set compliance status.";

/** A source reference in the form an assessor reads: the fact keys, the page, or the rule that computed it. */
export function sourceSummary(observation: ObservationView): string {
  const parts: string[] = [];
  if (observation.sourceFactKeys.length > 0) parts.push(observation.sourceFactKeys.join(", "));
  if (observation.pageRef) parts.push(observation.pageRef);
  if (parts.length === 0 && observation.ruleCode) parts.push(`computed by ${observation.ruleCode}`);
  return parts.length > 0 ? parts.join(" · ") : "no source reference";
}
