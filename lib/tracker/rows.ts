import type { ComplianceRating } from "@/lib/rules/constants";
import type { DbModule } from "@/lib/db/common";
import { COMPLIANCE_RATINGS } from "@/lib/rules/constants";

/**
 * The Excel project tracker (this prompt, "required by the RFP"): one
 * row per assessment, written entirely from platform activity — never a
 * field a PM types into the spreadsheet by hand. Every date below is a
 * real, stored timestamp; where this platform genuinely captures no
 * distinct timestamp for a named RFP field, that column is left null
 * rather than guessed (CONTEXT.md rule 7), documented in
 * docs/decisions.md.
 */

export interface TrackerRequirementRating {
  requirementSlNo: number;
  requirementTitle: string;
  rating: ComplianceRating | null;
}

export interface TrackerRow {
  subjectCode: string;
  module: DbModule;
  entityName: string;
  facilityName: string | null;
  auditNumber: number;
  assessmentType: "initial" | "follow_up";
  rfiIssueDate: string | null;
  desktopAssessmentDate: string | null;
  completedDesktopAssessmentDate: string | null;
  officeVisitDate: string | null;
  completedVisitDate: string | null;
  reportCompletionDate: string | null;
  reportQaCompletionDate: string | null;
  reportApprovalDate: string | null;
  reportIssuanceDate: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  requirements: TrackerRequirementRating[];
}

export interface TrackerRowWithSummary extends TrackerRow {
  ratingCounts: Record<ComplianceRating | "notAssessed", number>;
  /** e.g. "Compliant: 1, 2, 3; Partial: 11; Not Compliant: 8; Not Applicable: 20" — the requested "list of requirements by rating," in one readable cell. */
  requirementsByRatingSummary: string;
}

/**
 * Counts, and a one-cell readable summary, of which requirements fell
 * into which rating — "the list of requirements by rating" (this
 * prompt). Requirements with no decided status (compliance_status still
 * null) are counted separately as "notAssessed" rather than silently
 * dropped, since an incomplete assessment is itself worth tracking.
 */
export function summarizeRequirementsByRating(requirements: readonly TrackerRequirementRating[]): {
  ratingCounts: TrackerRowWithSummary["ratingCounts"];
  requirementsByRatingSummary: string;
} {
  const byRating = new Map<ComplianceRating, number[]>();
  let notAssessed = 0;
  for (const requirement of requirements) {
    if (requirement.rating === null) {
      notAssessed += 1;
      continue;
    }
    const list = byRating.get(requirement.rating) ?? [];
    list.push(requirement.requirementSlNo);
    byRating.set(requirement.rating, list);
  }

  const ratingCounts = {
    Compliant: (byRating.get("Compliant") ?? []).length,
    Partial: (byRating.get("Partial") ?? []).length,
    "Not Compliant": (byRating.get("Not Compliant") ?? []).length,
    "Not Applicable": (byRating.get("Not Applicable") ?? []).length,
    notAssessed,
  };

  const parts = COMPLIANCE_RATINGS.filter((rating) => (byRating.get(rating) ?? []).length > 0).map(
    (rating) => `${rating}: ${byRating.get(rating)!.sort((a, b) => a - b).join(", ")}`,
  );
  if (notAssessed > 0) parts.push(`Not assessed: ${notAssessed}`);

  return { ratingCounts, requirementsByRatingSummary: parts.join("; ") || "No requirements recorded." };
}

export function buildTrackerRows(rows: readonly TrackerRow[]): TrackerRowWithSummary[] {
  return rows.map((row) => ({ ...row, ...summarizeRequirementsByRating(row.requirements) }));
}
