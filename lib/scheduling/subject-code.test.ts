import { describe, expect, it } from "vitest";
import { assessmentTypeCode, buildSubjectCode, formatAuditNumber, nextAuditNumber } from "./subject-code";

describe("assessmentTypeCode", () => {
  it("maps initial to IN and follow_up to FU", () => {
    expect(assessmentTypeCode("initial")).toBe("IN");
    expect(assessmentTypeCode("follow_up")).toBe("FU");
  });
});

describe("formatAuditNumber", () => {
  it("formats whole numbers with no decimal", () => {
    expect(formatAuditNumber(1)).toBe("1");
    expect(formatAuditNumber(4)).toBe("4");
  });

  it("formats a follow-up decimal with exactly one decimal place", () => {
    expect(formatAuditNumber(3.5)).toBe("3.5");
  });
});

describe("nextAuditNumber", () => {
  it("starts a brand-new entity/module at 1", () => {
    expect(nextAuditNumber(undefined, "initial")).toBe(1);
  });

  it("reproduces CONTEXT.md's own sequence: 3, 3.5, 4", () => {
    expect(nextAuditNumber(3, "follow_up")).toBe(3.5);
    expect(nextAuditNumber(3.5, "initial")).toBe(4);
  });

  it("increments a full audit to the next whole number regardless of an in-between decimal", () => {
    expect(nextAuditNumber(2, "initial")).toBe(3);
    expect(nextAuditNumber(2.5, "initial")).toBe(3);
  });

  it("a follow-up always lands on floor(last) + .5", () => {
    expect(nextAuditNumber(5, "follow_up")).toBe(5.5);
  });
});

describe("buildSubjectCode", () => {
  it("omits the audit-number suffix for an entity/module's first assessment", () => {
    expect(
      buildSubjectCode({
        year: 2022,
        module: "accommodation",
        assessmentType: "follow_up",
        entityOrFacilityCode: "DIC",
        auditNumber: 1,
      }),
    ).toBe("2022-ACM-FU-DIC");
  });

  it("includes a decimal audit number, matching CONTEXT.md's own example", () => {
    expect(
      buildSubjectCode({
        year: 2023,
        module: "employment_practices",
        assessmentType: "follow_up",
        entityOrFacilityCode: "GLIS",
        auditNumber: 3.5,
      }),
    ).toBe("2023-EP-FU-GLIS-3.5");
  });

  it("includes a whole-number audit number above 1", () => {
    expect(
      buildSubjectCode({
        year: 2026,
        module: "onboarding",
        assessmentType: "initial",
        entityOrFacilityCode: "SEED-GC-1",
        auditNumber: 4,
      }),
    ).toBe("2026-ONB-IN-SEED-GC-1-4");
  });
});
