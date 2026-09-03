import { isKeyRequirement, type RiskRating } from "./constants";
import type { ComplianceRating } from "./constants";
import type { CycleRatedEntity, RequirementAssessment } from "./types";

/**
 * Report header metrics (Risk, Overall Compliance %, Compliance adjusted for not
 * assessed %). The compliance *ratings* themselves always come from a human
 * assessor — this module only does the arithmetic the product rules say a
 * model must never be trusted with.
 *
 * The exact scoring/risk formulas are not specified in the client's report
 * format, only the three figures that must appear. The choices below are
 * documented assumptions (see docs/decisions.md) and are isolated here so
 * they can be swapped without touching validation or callers. The weights
 * themselves are configurable (`0032_scoring_weights.sql` — admin-editable,
 * versioned, the same pattern as `rule_definitions`) rather than the fixed
 * constant this module used to carry: every caller now passes the weight
 * record a report was actually generated under, so "which weights produced
 * this percentage" is always a stored fact, not an assumption baked into
 * the code. See docs/decisions.md — the client's own formula still needs
 * confirming; these are a starting default, not a verified match.
 */

/** compliant/partial/notCompliant weights. Not Applicable has no weight — it is excluded from scoring entirely, never given a value of 0. */
export interface ScoringWeights {
  compliant: number;
  partial: number;
  notCompliant: number;
}

/** `0032_scoring_weights.sql`'s seeded version 1 — Compliant 1.0, Partial 0.5, Not Compliant 0, matching this module's original hardcoded values. */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = { compliant: 1, partial: 0.5, notCompliant: 0 };

function weightFor(rating: Exclude<ComplianceRating, "Not Applicable">, weights: ScoringWeights): number {
  if (rating === "Compliant") return weights.compliant;
  if (rating === "Partial") return weights.partial;
  return weights.notCompliant;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isScorable(rating: ComplianceRating): rating is Exclude<ComplianceRating, "Not Applicable"> {
  return rating !== "Not Applicable";
}

/**
 * Percentage compliance across a set of ratings, excluding Not Applicable ratings
 * from both the numerator and denominator. Returns null when there is nothing
 * scorable to report — callers should render "cannot be determined from this
 * evidence" rather than a fabricated number.
 */
export function compliancePercentFromRatings(ratings: ComplianceRating[], weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS): number | null {
  const scorable = ratings.filter(isScorable);
  if (scorable.length === 0) {
    return null;
  }
  const total = scorable.reduce((sum, rating) => sum + weightFor(rating, weights), 0);
  return round2((total / scorable.length) * 100);
}

/**
 * "Overall Compliance (%)": scored across every requirement/area in scope for
 * the cycle, including items carried forward (not assessed this cycle) at
 * their inherited rating.
 */
export function computeOverallCompliancePercent(entities: CycleRatedEntity[], weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS): number | null {
  return compliancePercentFromRatings(
    entities.map((entity) => entity.rating),
    weights,
  );
}

/**
 * "Compliance adjusted for not assessed (%)": scored only across
 * requirements/areas actually assessed this cycle, excluding carried-forward
 * items from the denominator.
 */
export function computeComplianceAdjustedForNotAssessedPercent(
  entities: CycleRatedEntity[],
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): number | null {
  const assessedThisCycle = entities.filter((entity) => entity.assessedThisCycle);
  return compliancePercentFromRatings(
    assessedThisCycle.map((entity) => entity.rating),
    weights,
  );
}

/**
 * Risk rating driven by the 10 key requirements:
 * - High: any key requirement rated Not Compliant.
 * - Medium: no key requirement Not Compliant, but a key requirement is Partial,
 *   or a non-key requirement is Not Compliant.
 * - Low: otherwise.
 * Only meaningful for Employment Practices / Onboarding, which define key requirements.
 */
export function computeRiskRating(assessments: RequirementAssessment[]): RiskRating {
  const keyAssessments = assessments.filter((assessment) => isKeyRequirement(assessment.requirementNumber));
  const nonKeyAssessments = assessments.filter(
    (assessment) => !isKeyRequirement(assessment.requirementNumber),
  );

  if (keyAssessments.some((assessment) => assessment.rating === "Not Compliant")) {
    return "High";
  }
  if (
    keyAssessments.some((assessment) => assessment.rating === "Partial") ||
    nonKeyAssessments.some((assessment) => assessment.rating === "Not Compliant")
  ) {
    return "Medium";
  }
  return "Low";
}
