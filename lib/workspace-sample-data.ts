import type { RequirementAssessment } from "@/lib/rules/types";

export const SAMPLE_ENTITY_NAME = "Sample contractor LLC";
export const SAMPLE_CYCLE_LABEL = "Employment practices, cycle 7";

const TITLES: Record<number, string> = {
  1: "Written contract issued in a language the worker understands",
  2: "Contract terms match the offer letter",
  3: "No unauthorised contract substitution",
  4: "Working hours within contractual and legal limits",
  5: "Overtime paid at the correct rate",
  6: "Wages match the contract",
  7: "Wages paid by bank transfer",
  8: "Wages paid on time and in full",
  9: "Payslips issued each pay cycle",
  10: "No unlawful deductions from wages",
  11: "Passports and personal documents held only with consent",
  12: "Freedom of movement respected",
  13: "Freedom to resign respected",
  14: "Recruitment fees not charged to the worker",
  15: "Induction covers rights and grievance channels",
  16: "Grievance mechanism accessible to all workers",
  17: "Grievances resolved within policy timelines",
  18: "No retaliation against workers who raise grievances",
  19: "No unauthorised recruitment fees charged",
  20: "Medical insurance provided and active",
  21: "Workers have access to first aid and emergency care",
  22: "Health and safety training completed before site access",
  23: "Emergency contacts and procedures displayed and understood",
};

/** 23 requirements, most already rated to make the table read as real work in progress. */
export const SAMPLE_REQUIREMENTS: RequirementAssessment[] = Array.from(
  { length: 23 },
  (_, i) => {
    const requirementNumber = i + 1;
    return {
      requirementNumber,
      rating: "Compliant",
      remark: "Consistent with policy and worker interviews.",
      actionRequiredForClosure: null,
      assessedThisCycle: true,
    } satisfies RequirementAssessment;
  },
);

// Hand-set a few rows so the demo shows the states an assessor actually meets:
// an unresolved partial, an open not-compliant, a not-applicable with its
// required remark, an unrated row, and a carried-forward requirement.
function set(requirementNumber: number, patch: Partial<RequirementAssessment>) {
  const row = SAMPLE_REQUIREMENTS.find((r) => r.requirementNumber === requirementNumber);
  if (row) Object.assign(row, patch);
}

set(5, {
  rating: "Partial",
  remark: "Overtime rate applied is 1.25x; contract and law require 1.5x.",
  actionRequiredForClosure: "Contractor to recalculate and back-pay affected workers by 30 Apr.",
});
set(8, {
  rating: "Not Compliant",
  remark: "Payroll records for Feb 2024 show a 6-day delay against the contract due date.",
  actionRequiredForClosure: "Contractor to issue a revised payroll SOP by 30 Apr 2024.",
});
set(14, {
  rating: "Not Applicable",
  remark: "No recruitment activity took place this cycle; all workers carried over from prior contracts.",
  actionRequiredForClosure: null,
});
set(19, {
  rating: "Compliant",
  remark:
    "This section was not assessed as part of this review. Previous monitoring has identified the policies, procedures and their application relating to this section as compliant with Aldar's Worker Welfare Policy.",
  actionRequiredForClosure: "N/A",
  assessedThisCycle: false,
});
set(22, {
  rating: "Partial",
  remark: "",
  actionRequiredForClosure: "",
});

export function titleFor(requirementNumber: number): string {
  return TITLES[requirementNumber] ?? `Requirement ${requirementNumber}`;
}
