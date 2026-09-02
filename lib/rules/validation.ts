import type {
  AccommodationAreaAssessment,
  QuestionResult,
  RatedEntity,
  RequirementAssessment,
} from "./types";

/**
 * Validation only. This module never assigns or infers a compliance status —
 * that is written exclusively by a human assessor. It checks that a status
 * already chosen by an assessor carries the remark and closure action the
 * fixed compliance rules require, and reports what's missing so the item can
 * be routed back to the assessor.
 */
export type ValidationIssue = {
  field: "remark" | "actionRequiredForClosure";
  message: string;
};

function isBlank(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

/**
 * Question-level rules:
 * - No, Unclear, or Not Applicable requires a remark.
 * - No or Unclear requires an action required for closure.
 */
export function validateQuestionResult(result: QuestionResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const requiresRemark =
    result.answer === "No" || result.answer === "Unclear" || result.answer === "Not Applicable";
  const requiresClosureAction = result.answer === "No" || result.answer === "Unclear";

  if (requiresRemark && isBlank(result.remark)) {
    issues.push({ field: "remark", message: `An answer of "${result.answer}" requires a remark.` });
  }
  if (requiresClosureAction && isBlank(result.actionRequiredForClosure)) {
    issues.push({
      field: "actionRequiredForClosure",
      message: `An answer of "${result.answer}" requires an action required for closure.`,
    });
  }
  return issues;
}

/**
 * Requirement/area-level rules:
 * - Partial or Not Compliant requires an action required for closure.
 * - Not Applicable requires a remark explaining why (no closure action needed).
 */
export function validateRatedEntity(entity: RatedEntity): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const requiresClosureAction = entity.rating === "Partial" || entity.rating === "Not Compliant";
  const requiresRemark = entity.rating === "Not Applicable";

  if (requiresRemark && isBlank(entity.remark)) {
    issues.push({
      field: "remark",
      message: `A rating of "Not Applicable" requires a remark explaining why.`,
    });
  }
  if (requiresClosureAction && isBlank(entity.actionRequiredForClosure)) {
    issues.push({
      field: "actionRequiredForClosure",
      message: `A rating of "${entity.rating}" requires an action required for closure.`,
    });
  }
  return issues;
}

export type RequirementValidationResult = {
  requirementNumber: number;
  issues: ValidationIssue[];
};

export function validateRequirementAssessments(
  assessments: RequirementAssessment[],
): RequirementValidationResult[] {
  return assessments
    .map((assessment) => ({
      requirementNumber: assessment.requirementNumber,
      issues: validateRatedEntity(assessment),
    }))
    .filter((result) => result.issues.length > 0);
}

export type AccommodationAreaValidationResult = {
  areaNumber: number;
  issues: ValidationIssue[];
};

export function validateAccommodationAreaAssessments(
  assessments: AccommodationAreaAssessment[],
): AccommodationAreaValidationResult[] {
  return assessments
    .map((assessment) => ({
      areaNumber: assessment.areaNumber,
      issues: validateRatedEntity(assessment),
    }))
    .filter((result) => result.issues.length > 0);
}

export type QuestionValidationResult = {
  questionId: string;
  issues: ValidationIssue[];
};

export function validateQuestionResults(results: QuestionResult[]): QuestionValidationResult[] {
  return results
    .map((result) => ({ questionId: result.questionId, issues: validateQuestionResult(result) }))
    .filter((result) => result.issues.length > 0);
}
