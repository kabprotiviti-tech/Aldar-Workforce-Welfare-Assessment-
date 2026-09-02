import { describe, expect, it } from "vitest";
import {
  validateAccommodationAreaAssessments,
  validateQuestionResult,
  validateQuestionResults,
  validateRatedEntity,
  validateRequirementAssessments,
} from "./validation";
import type { AccommodationAreaAssessment, QuestionResult, RequirementAssessment } from "./types";

function question(overrides: Partial<QuestionResult> = {}): QuestionResult {
  return {
    questionId: "q1",
    answer: "Yes",
    remark: null,
    actionRequiredForClosure: null,
    ...overrides,
  };
}

function requirement(overrides: Partial<RequirementAssessment> = {}): RequirementAssessment {
  return {
    requirementNumber: 1,
    rating: "Compliant",
    remark: null,
    actionRequiredForClosure: null,
    assessedThisCycle: true,
    ...overrides,
  };
}

function accommodationArea(overrides: Partial<AccommodationAreaAssessment> = {}): AccommodationAreaAssessment {
  return {
    areaNumber: 1,
    rating: "Compliant",
    remark: null,
    actionRequiredForClosure: null,
    assessedThisCycle: true,
    ...overrides,
  };
}

describe("validateQuestionResult", () => {
  it("requires nothing for Yes", () => {
    expect(validateQuestionResult(question({ answer: "Yes" }))).toEqual([]);
  });

  it("requires a remark for No without one", () => {
    const issues = validateQuestionResult(question({ answer: "No" }));
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.field)).toEqual(
      expect.arrayContaining(["remark", "actionRequiredForClosure"]),
    );
  });

  it("passes for No with both remark and closure action", () => {
    const issues = validateQuestionResult(
      question({ answer: "No", remark: "Missing policy.", actionRequiredForClosure: "Draft policy." }),
    );
    expect(issues).toEqual([]);
  });

  it("requires a remark and closure action for Unclear", () => {
    const issues = validateQuestionResult(question({ answer: "Unclear" }));
    expect(issues.map((i) => i.field).sort()).toEqual(["actionRequiredForClosure", "remark"]);
  });

  it("requires only a remark for Not Applicable, not a closure action", () => {
    const withoutRemark = validateQuestionResult(question({ answer: "Not Applicable" }));
    expect(withoutRemark).toEqual([{ field: "remark", message: expect.any(String) }]);

    const withRemark = validateQuestionResult(
      question({ answer: "Not Applicable", remark: "Role does not apply to this site." }),
    );
    expect(withRemark).toEqual([]);
  });

  it("treats a whitespace-only remark as blank", () => {
    const issues = validateQuestionResult(question({ answer: "No", remark: "   ", actionRequiredForClosure: "Fix it" }));
    expect(issues).toEqual([{ field: "remark", message: expect.any(String) }]);
  });
});

describe("validateRatedEntity (requirement/area level)", () => {
  it("requires nothing for Compliant", () => {
    expect(validateRatedEntity(requirement({ rating: "Compliant" }))).toEqual([]);
  });

  it("requires a closure action for Partial", () => {
    const issues = validateRatedEntity(requirement({ rating: "Partial" }));
    expect(issues).toEqual([{ field: "actionRequiredForClosure", message: expect.any(String) }]);
  });

  it("requires a closure action for Not Compliant", () => {
    const issues = validateRatedEntity(requirement({ rating: "Not Compliant" }));
    expect(issues).toEqual([{ field: "actionRequiredForClosure", message: expect.any(String) }]);
  });

  it("passes for Partial once a closure action is supplied", () => {
    const issues = validateRatedEntity(
      requirement({ rating: "Partial", actionRequiredForClosure: "Retrain site HR by Q3." }),
    );
    expect(issues).toEqual([]);
  });

  it("requires a remark (not a closure action) for Not Applicable", () => {
    const issues = validateRatedEntity(requirement({ rating: "Not Applicable" }));
    expect(issues).toEqual([{ field: "remark", message: expect.any(String) }]);
  });

  it("passes for Not Applicable once a remark is supplied", () => {
    const issues = validateRatedEntity(
      requirement({ rating: "Not Applicable", remark: "No workers of this category on site." }),
    );
    expect(issues).toEqual([]);
  });
});

describe("validateRequirementAssessments / validateAccommodationAreaAssessments", () => {
  it("only returns entries that have outstanding issues", () => {
    const results = validateRequirementAssessments([
      requirement({ requirementNumber: 5, rating: "Compliant" }),
      requirement({ requirementNumber: 8, rating: "Not Compliant" }),
    ]);
    expect(results).toEqual([{ requirementNumber: 8, issues: [expect.any(Object)] }]);
  });

  it("applies the same rules to accommodation areas", () => {
    const results = validateAccommodationAreaAssessments([
      accommodationArea({ areaNumber: 3, rating: "Partial" }),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.areaNumber).toBe(3);
  });
});

describe("validateQuestionResults", () => {
  it("filters down to only questions with issues", () => {
    const results = validateQuestionResults([
      question({ questionId: "a", answer: "Yes" }),
      question({ questionId: "b", answer: "No" }),
    ]);
    expect(results).toEqual([{ questionId: "b", issues: expect.any(Array) }]);
  });
});
