import type { AnalysedReading } from "@/lib/vision/analyse";
import type { PhotoClass } from "@/lib/vision/classes";

/**
 * The photograph-analysis vocabulary the review panel and the page
 * share, kept pure so both — and the tests — use the same words.
 */

export type PhotoAnalysisStatus = "proposed" | "accepted" | "edited" | "rejected";

export interface PhotoAnalysisView {
  id: string;
  photoId: string;
  photoClass: PhotoClass;
  readings: AnalysedReading[];
  cannotDetermine: string[];
  suppressed: string[];
  status: PhotoAnalysisStatus;
  rejectionReason: string | null;
  error: string | null;
  model: string;
  createdAt: string;
}

export interface InspectionPhotoView {
  id: string;
  storagePath: string;
  signedUrl: string | null;
  photoClass: PhotoClass | null;
  roomRef: string | null;
  capturedAt: string | null;
  requirementTitle: string | null;
  analysis: PhotoAnalysisView | null;
}

/**
 * The standing notice on the review screen, the counterpart to
 * OBSERVATION_NOTICE (lib/observations/store.ts). The distinction it
 * draws is this prompt's: an analysis is an observation about what is
 * visible, never an answer to an inspection question and never a status.
 */
export const PHOTO_ANALYSIS_NOTICE =
  "Photograph analysis produces observations, never answers or compliance status. Confirm each reading against the image yourself.";

export const OBSERVED_LABELS: Record<AnalysedReading["observed"], string> = {
  present: "Visible",
  absent: "Not visible",
  unclear: "Unclear",
};

/** How one reading reads in a list: the field's description, then what the model saw. */
export function readingSummary(reading: AnalysedReading): string {
  if (reading.kind === "count_in_frame" && reading.countInFrame !== null) {
    return `${reading.countInFrame} visible in this frame`;
  }
  if (reading.kind === "list") {
    return reading.values.length > 0 ? reading.values.join(", ") : OBSERVED_LABELS[reading.observed];
  }
  if (reading.kind === "text" && reading.verbatimText !== null) {
    return `“${reading.verbatimText}”`;
  }
  if (reading.kind === "condition" && reading.condition !== null) {
    return reading.condition;
  }
  return OBSERVED_LABELS[reading.observed];
}

/** Only these analyses reach the assessor workspace and the report — the view enforces the same thing in SQL. */
export function isConfirmed(status: PhotoAnalysisStatus): boolean {
  return status === "accepted" || status === "edited";
}
