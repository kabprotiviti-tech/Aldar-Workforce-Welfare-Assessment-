/**
 * Fixed vocabulary and structural constants for the WWAP compliance rule engine.
 * These mirror the product rules exactly — do not add ratings or renumber requirements
 * without updating docs/decisions.md.
 */

export const QUESTION_ANSWERS = ["Yes", "No", "Unclear", "Not Applicable"] as const;
export type QuestionAnswer = (typeof QUESTION_ANSWERS)[number];

export const COMPLIANCE_RATINGS = ["Compliant", "Partial", "Not Compliant", "Not Applicable"] as const;
export type ComplianceRating = (typeof COMPLIANCE_RATINGS)[number];

/** Employment Practices and Onboarding share the same 23 worker welfare requirements. */
export const TOTAL_WORKER_WELFARE_REQUIREMENTS = 23;

/** Requirement numbers (1-indexed) designated as key requirements for EP/Onboarding. */
export const KEY_REQUIREMENT_NUMBERS = [5, 8, 10, 11, 14, 16, 17, 18, 19, 22] as const;

export function isKeyRequirement(requirementNumber: number): boolean {
  return (KEY_REQUIREMENT_NUMBERS as readonly number[]).includes(requirementNumber);
}

/** Accommodation checklist has 12 assessment areas. */
export const TOTAL_ACCOMMODATION_AREAS = 12;

export const MODULES = ["EP", "ONB", "ACM"] as const;
export type Module = (typeof MODULES)[number];

export const RISK_RATINGS = ["Low", "Medium", "High"] as const;
export type RiskRating = (typeof RISK_RATINGS)[number];
