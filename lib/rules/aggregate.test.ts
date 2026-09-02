import { describe, expect, it } from "vitest";
import {
  compliancePercentFromRatings,
  computeComplianceAdjustedForNotAssessedPercent,
  computeOverallCompliancePercent,
  computeRiskRating,
} from "./aggregate";
import { KEY_REQUIREMENT_NUMBERS } from "./constants";
import type { CycleRatedEntity, RequirementAssessment } from "./types";

function entity(overrides: Partial<CycleRatedEntity> = {}): CycleRatedEntity {
  return {
    rating: "Compliant",
    remark: null,
    actionRequiredForClosure: null,
    assessedThisCycle: true,
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

describe("compliancePercentFromRatings", () => {
  it("returns null when there is nothing scorable", () => {
    expect(compliancePercentFromRatings([])).toBeNull();
    expect(compliancePercentFromRatings(["Not Applicable", "Not Applicable"])).toBeNull();
  });

  it("scores all-Compliant as 100", () => {
    expect(compliancePercentFromRatings(["Compliant", "Compliant"])).toBe(100);
  });

  it("scores all-Not-Compliant as 0", () => {
    expect(compliancePercentFromRatings(["Not Compliant", "Not Compliant"])).toBe(0);
  });

  it("weights Partial as half credit", () => {
    expect(compliancePercentFromRatings(["Compliant", "Partial"])).toBe(75);
  });

  it("excludes Not Applicable from both numerator and denominator", () => {
    expect(compliancePercentFromRatings(["Compliant", "Not Applicable", "Not Compliant"])).toBe(50);
  });
});

describe("computeOverallCompliancePercent", () => {
  it("includes carried-forward (not assessed this cycle) entities at their inherited rating", () => {
    const percent = computeOverallCompliancePercent([
      entity({ rating: "Compliant", assessedThisCycle: true }),
      entity({ rating: "Not Compliant", assessedThisCycle: false }),
    ]);
    expect(percent).toBe(50);
  });
});

describe("computeComplianceAdjustedForNotAssessedPercent", () => {
  it("excludes carried-forward entities from the denominator", () => {
    const percent = computeComplianceAdjustedForNotAssessedPercent([
      entity({ rating: "Compliant", assessedThisCycle: true }),
      entity({ rating: "Not Compliant", assessedThisCycle: false }),
    ]);
    expect(percent).toBe(100);
  });

  it("returns null when nothing was assessed this cycle", () => {
    const percent = computeComplianceAdjustedForNotAssessedPercent([
      entity({ rating: "Compliant", assessedThisCycle: false }),
    ]);
    expect(percent).toBeNull();
  });
});

describe("computeRiskRating", () => {
  const firstKeyRequirement = KEY_REQUIREMENT_NUMBERS[0];
  const firstNonKeyRequirement = 1;

  it("is Low when everything is Compliant", () => {
    const assessments = KEY_REQUIREMENT_NUMBERS.map((n) => requirement({ requirementNumber: n }));
    expect(computeRiskRating(assessments)).toBe("Low");
  });

  it("is High when any key requirement is Not Compliant", () => {
    const assessments = [requirement({ requirementNumber: firstKeyRequirement, rating: "Not Compliant" })];
    expect(computeRiskRating(assessments)).toBe("High");
  });

  it("is Medium when a key requirement is Partial", () => {
    const assessments = [requirement({ requirementNumber: firstKeyRequirement, rating: "Partial" })];
    expect(computeRiskRating(assessments)).toBe("Medium");
  });

  it("is Medium when a non-key requirement is Not Compliant, even with clean key requirements", () => {
    const assessments = [
      requirement({ requirementNumber: firstKeyRequirement, rating: "Compliant" }),
      requirement({ requirementNumber: firstNonKeyRequirement, rating: "Not Compliant" }),
    ];
    expect(computeRiskRating(assessments)).toBe("Medium");
  });

  it("prioritizes High over Medium when both conditions are present", () => {
    const assessments = [
      requirement({ requirementNumber: firstKeyRequirement, rating: "Not Compliant" }),
      requirement({ requirementNumber: firstNonKeyRequirement, rating: "Not Compliant" }),
    ];
    expect(computeRiskRating(assessments)).toBe("High");
  });
});
