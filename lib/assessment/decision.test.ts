import { describe, expect, it } from "vitest";
import {
  assessmentProgress,
  completionOf,
  EMPTY_EVIDENCE_DETAIL,
  evidenceDetailSchema,
  parseEvidenceDetail,
  validateAssessment,
  validateItemDecision,
  type ItemDecision,
} from "./decision";

function item(overrides: Partial<ItemDecision> = {}): ItemDecision {
  return {
    requirementSlNo: 11,
    requirementTitle: "Timely wage payment",
    isKey: true,
    status: "Compliant",
    remarks: null,
    actionRequired: null,
    ...overrides,
  };
}

describe("validateItemDecision", () => {
  it("passes a Compliant requirement with nothing else required", () => {
    expect(validateItemDecision(item({ status: "Compliant" }))).toEqual([]);
  });

  it("blocks a requirement with no status, naming it", () => {
    const issues = validateItemDecision(item({ status: null }));

    expect(issues).toEqual([
      { requirementSlNo: 11, field: "status", message: "Requirement 11 (Timely wage payment) has no compliance status yet." },
    ]);
  });

  it("blocks Partial without a closure action, naming the requirement", () => {
    const issues = validateItemDecision(item({ status: "Partial" }));

    expect(issues).toHaveLength(1);
    expect(issues[0]!.field).toBe("actionRequiredForClosure");
    expect(issues[0]!.message).toContain("Requirement 11 (Timely wage payment)");
    expect(issues[0]!.message).toContain("action required for closure");
  });

  it("blocks Not Compliant without a closure action", () => {
    expect(validateItemDecision(item({ status: "Not Compliant" }))).toHaveLength(1);
  });

  it("accepts Partial once a closure action is given", () => {
    expect(validateItemDecision(item({ status: "Partial", actionRequired: "Transfer April wages and evidence the WPS confirmation." }))).toEqual([]);
  });

  it("blocks Not Applicable without a remark explaining why", () => {
    const issues = validateItemDecision(item({ status: "Not Applicable" }));

    expect(issues).toHaveLength(1);
    expect(issues[0]!.field).toBe("remark");
    expect(issues[0]!.message).toContain("Requirement 11");
  });

  it("accepts Not Applicable with a remark", () => {
    expect(validateItemDecision(item({ status: "Not Applicable", remarks: "The entity employs no workers in this category." }))).toEqual([]);
  });

  it("treats whitespace as missing", () => {
    expect(validateItemDecision(item({ status: "Partial", actionRequired: "   " }))).toHaveLength(1);
  });
});

describe("validateAssessment", () => {
  it("reports every blocking issue across requirements, in requirement order", () => {
    const issues = validateAssessment([
      item({ requirementSlNo: 16, requirementTitle: "Legal working hours", status: "Not Compliant" }),
      item({ requirementSlNo: 11, requirementTitle: "Timely wage payment", status: null }),
      item({ requirementSlNo: 12, requirementTitle: "Full wages and benefits", status: "Compliant" }),
    ]);

    expect(issues.map((issue) => issue.requirementSlNo)).toEqual([11, 16]);
    expect(issues[0]!.message).toContain("Requirement 11");
    expect(issues[1]!.message).toContain("Requirement 16");
  });

  it("returns nothing when every requirement is properly decided", () => {
    const issues = validateAssessment([
      item({ requirementSlNo: 11, status: "Compliant" }),
      item({ requirementSlNo: 12, status: "Partial", actionRequired: "Reimburse the deducted amounts." }),
      item({ requirementSlNo: 13, status: "Not Applicable", remarks: "No overtime worked in the period." }),
    ]);

    expect(issues).toEqual([]);
  });
});

describe("completionOf / assessmentProgress", () => {
  it("separates not started, incomplete and complete", () => {
    expect(completionOf(item({ status: null }))).toBe("not_started");
    expect(completionOf(item({ status: "Partial" }))).toBe("incomplete");
    expect(completionOf(item({ status: "Partial", actionRequired: "Do the thing." }))).toBe("complete");
    expect(completionOf(item({ status: "Compliant" }))).toBe("complete");
  });

  it("counts progress across the checklist, and key requirements still outstanding", () => {
    const progress = assessmentProgress([
      item({ requirementSlNo: 1, isKey: false, status: "Compliant" }),
      item({ requirementSlNo: 5, isKey: true, status: null }),
      item({ requirementSlNo: 8, isKey: true, status: "Not Compliant" }),
      item({ requirementSlNo: 9, isKey: false, status: null }),
    ]);

    expect(progress).toEqual({ total: 4, complete: 1, incomplete: 1, notStarted: 2, keyOutstanding: 1 });
  });

  it("reads an empty checklist as zero, not as complete", () => {
    expect(assessmentProgress([])).toEqual({ total: 0, complete: 0, incomplete: 0, notStarted: 0, keyOutstanding: 0 });
  });
});

describe("evidenceDetailSchema", () => {
  it("accepts the specific numbers a report needs", () => {
    const parsed = evidenceDetailSchema.parse({
      salaryTransferDates: ["2026-05-03", "2026-06-02"],
      deductionExamples: [{ type: "Accommodation", amountAed: 250, note: "Contractual, signed" }],
      sampleSizes: [{ label: "Payslips", sampled: 12, population: 120 }],
    });

    expect(parsed.sampleSizes[0]).toEqual({ label: "Payslips", sampled: 12, population: 120 });
    expect(parsed.deductionExamples[0]!.amountAed).toBe(250);
  });

  it("defaults each list to empty rather than undefined", () => {
    expect(evidenceDetailSchema.parse({})).toEqual(EMPTY_EVIDENCE_DETAIL);
  });

  it("rejects a negative sample size", () => {
    expect(evidenceDetailSchema.safeParse({ sampleSizes: [{ label: "Payslips", sampled: -1, population: 10 }] }).success).toBe(false);
  });

  it("allows a deduction with no amount recorded, but not with no type", () => {
    expect(evidenceDetailSchema.safeParse({ deductionExamples: [{ type: "Transport", amountAed: null, note: null }] }).success).toBe(true);
    expect(evidenceDetailSchema.safeParse({ deductionExamples: [{ type: "", amountAed: 10, note: null }] }).success).toBe(false);
  });
});

describe("parseEvidenceDetail", () => {
  it("reads stored jsonb back", () => {
    expect(parseEvidenceDetail({ salaryTransferDates: ["2026-05-03"] })).toMatchObject({ salaryTransferDates: ["2026-05-03"] });
  });

  it("falls back to empty for null or a shape it cannot read, rather than throwing on a page render", () => {
    expect(parseEvidenceDetail(null)).toEqual(EMPTY_EVIDENCE_DETAIL);
    expect(parseEvidenceDetail({ sampleSizes: "twelve" })).toEqual(EMPTY_EVIDENCE_DETAIL);
  });
});
