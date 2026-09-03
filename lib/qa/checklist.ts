import { isKeyRequirement, type ComplianceRating } from "@/lib/rules/constants";
import { quantitativeSchemaForArea } from "@/lib/db/accommodation-quantitative";
import { parseEvidenceDetail } from "@/lib/assessment/decision";
import type { DbModule } from "@/lib/db/common";

/**
 * The automated QA checklist (this prompt), run before an assessment can
 * pass QA. Pure — every input the eight rules need is passed in, so
 * this is provable without a database; lib/qa/checklist-supabase.ts is
 * the only thing that knows how to gather that input for real.
 */

export interface QaChecklistItemInput {
  itemId: string;
  requirementSlNo: number;
  requirementTitle: string;
  status: ComplianceRating | null;
  remarks: string | null;
  actionRequired: string | null;
  wasAssessed: boolean;
  /** Accommodation only — assessment_items.quantitative. */
  quantitative: unknown;
  /** Accommodation only — at least one photo attached against this item's requirement/area. */
  hasPhoto: boolean;
  /** EP/Onboarding only — assessment_items.evidence_detail. */
  evidenceDetail: unknown;
}

export interface QaChecklistInput {
  module: DbModule;
  items: readonly QaChecklistItemInput[];
  /** ai_observations with status = 'open', across this assessment. */
  openObservationCount: number;
  /** extracted_facts with status = 'proposed', across this assessment's evidence files. */
  proposedFactCount: number;
}

export const QA_CHECK_IDS = [
  "every_item_has_status",
  "failing_items_have_closure_action",
  "not_applicable_has_remark",
  "quantitative_fields_present",
  "specific_numbers_present",
  "observations_actioned",
  "facts_resolved",
  "photos_attached",
] as const;
export type QaCheckId = (typeof QA_CHECK_IDS)[number];

export interface QaCheckResult {
  id: QaCheckId;
  label: string;
  passed: boolean;
  /** Which items failed this check — empty for the two assessment-wide checks. */
  failingItemIds: string[];
  detail: string;
}

const QA_CHECK_LABELS: Record<QaCheckId, string> = {
  every_item_has_status: "Every requirement has a compliance status",
  failing_items_have_closure_action: "Every Partial/Not Compliant item has a remark and a closure action",
  not_applicable_has_remark: "Every Not Applicable item has an explanatory remark",
  quantitative_fields_present: "Mandatory quantitative fields are present",
  specific_numbers_present: "Specific numbers (sample sizes, dates) are recorded for key requirements",
  observations_actioned: "Every AI observation has been actioned",
  facts_resolved: "Every extracted fact has been resolved",
  photos_attached: "Photos are attached for every area",
};

function nonEmpty(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

/**
 * Rule 1: "every requirement has a status" — a null compliance_status is
 * the one thing that can never be true of a finished assessment,
 * carried-forward items included (carry-forward always writes a status,
 * even when it's inherited — lib/assessment/carry-forward.ts).
 */
function checkEveryItemHasStatus(items: readonly QaChecklistItemInput[]): QaCheckResult {
  const failing = items.filter((item) => item.status === null).map((item) => item.itemId);
  return { id: "every_item_has_status", label: QA_CHECK_LABELS.every_item_has_status, passed: failing.length === 0, failingItemIds: failing, detail: `${failing.length} of ${items.length} requirement(s) have no status.` };
}

/**
 * Rule 2: "every non-Compliant/Partial has a remark and a closure
 * action" — scoped to items genuinely assessed this cycle
 * (wasAssessed). A carried-forward item can legitimately read Partial
 * with actionRequired "N/A" (the boilerplate CONTEXT.md itself
 * specifies): carry-forward is only permitted once the underlying
 * finding was formally closed, so there is nothing left open to action
 * — see docs/decisions.md.
 */
function checkFailingItemsHaveClosureAction(items: readonly QaChecklistItemInput[]): QaCheckResult {
  const failing = items
    .filter((item) => item.wasAssessed && (item.status === "Partial" || item.status === "Not Compliant"))
    .filter((item) => !nonEmpty(item.remarks) || !nonEmpty(item.actionRequired))
    .map((item) => item.itemId);
  return {
    id: "failing_items_have_closure_action",
    label: QA_CHECK_LABELS.failing_items_have_closure_action,
    passed: failing.length === 0,
    failingItemIds: failing,
    detail: `${failing.length} Partial/Not Compliant item(s) are missing a remark or a closure action.`,
  };
}

/** Rule 3: "every Not Applicable has an explanatory remark." */
function checkNotApplicableHasRemark(items: readonly QaChecklistItemInput[]): QaCheckResult {
  const failing = items.filter((item) => item.status === "Not Applicable" && !nonEmpty(item.remarks)).map((item) => item.itemId);
  return {
    id: "not_applicable_has_remark",
    label: QA_CHECK_LABELS.not_applicable_has_remark,
    passed: failing.length === 0,
    failingItemIds: failing,
    detail: `${failing.length} Not Applicable item(s) are missing a remark.`,
  };
}

/**
 * Rule 4: "quantitative fields present where mandatory" — Accommodation
 * only (lib/db/accommodation-quantitative.ts's per-area schemas; areas
 * 7-10 have none, so they trivially pass). Trivially passes for
 * EP/Onboarding, which has no analogous per-item quantitative field.
 */
function checkQuantitativeFieldsPresent(module: DbModule, items: readonly QaChecklistItemInput[]): QaCheckResult {
  if (module !== "accommodation") {
    return { id: "quantitative_fields_present", label: QA_CHECK_LABELS.quantitative_fields_present, passed: true, failingItemIds: [], detail: "Not applicable outside Accommodation." };
  }
  const failing = items.filter((item) => !quantitativeSchemaForArea(item.requirementSlNo).safeParse(item.quantitative ?? {}).success).map((item) => item.itemId);
  return {
    id: "quantitative_fields_present",
    label: QA_CHECK_LABELS.quantitative_fields_present,
    passed: failing.length === 0,
    failingItemIds: failing,
    detail: `${failing.length} area(s) are missing a mandatory quantitative field.`,
  };
}

/**
 * Rule 5: "specific numbers present (sample sizes, dates)" —
 * EP/Onboarding only, and only for the 10 key requirements (the ones
 * the compliance rating is actually built around), genuinely assessed
 * this cycle with a substantive rating (not Not Applicable, which has
 * nothing to sample). Requires at least one recorded sample size —
 * lib/assessment/decision.ts's evidenceDetailSchema is where "12 of 120
 * payslips" and salary transfer dates both live. See docs/decisions.md.
 */
function checkSpecificNumbersPresent(module: DbModule, items: readonly QaChecklistItemInput[]): QaCheckResult {
  if (module === "accommodation") {
    return { id: "specific_numbers_present", label: QA_CHECK_LABELS.specific_numbers_present, passed: true, failingItemIds: [], detail: "Not applicable outside Employment Practices/Onboarding." };
  }
  const relevant = items.filter(
    (item) => item.wasAssessed && isKeyRequirement(item.requirementSlNo) && item.status !== null && item.status !== "Not Applicable",
  );
  const failing = relevant.filter((item) => parseEvidenceDetail(item.evidenceDetail).sampleSizes.length === 0).map((item) => item.itemId);
  return {
    id: "specific_numbers_present",
    label: QA_CHECK_LABELS.specific_numbers_present,
    passed: failing.length === 0,
    failingItemIds: failing,
    detail: `${failing.length} of ${relevant.length} key requirement(s) have no recorded sample size.`,
  };
}

function checkObservationsActioned(openObservationCount: number): QaCheckResult {
  return {
    id: "observations_actioned",
    label: QA_CHECK_LABELS.observations_actioned,
    passed: openObservationCount === 0,
    failingItemIds: [],
    detail: `${openObservationCount} AI observation(s) still open.`,
  };
}

function checkFactsResolved(proposedFactCount: number): QaCheckResult {
  return {
    id: "facts_resolved",
    label: QA_CHECK_LABELS.facts_resolved,
    passed: proposedFactCount === 0,
    failingItemIds: [],
    detail: `${proposedFactCount} extracted fact(s) still proposed.`,
  };
}

/**
 * Rule 8: "photos attached where the module requires them" — read as a
 * module-level requirement (Accommodation is a physical inspection;
 * Employment Practices/Onboarding are desk/office review and never
 * require a photo). See docs/decisions.md.
 */
function checkPhotosAttached(module: DbModule, items: readonly QaChecklistItemInput[]): QaCheckResult {
  if (module !== "accommodation") {
    return { id: "photos_attached", label: QA_CHECK_LABELS.photos_attached, passed: true, failingItemIds: [], detail: "Not applicable outside Accommodation." };
  }
  const failing = items.filter((item) => !item.hasPhoto).map((item) => item.itemId);
  return {
    id: "photos_attached",
    label: QA_CHECK_LABELS.photos_attached,
    passed: failing.length === 0,
    failingItemIds: failing,
    detail: `${failing.length} area(s) have no photo attached.`,
  };
}

export function runQaChecklist(input: QaChecklistInput): QaCheckResult[] {
  return [
    checkEveryItemHasStatus(input.items),
    checkFailingItemsHaveClosureAction(input.items),
    checkNotApplicableHasRemark(input.items),
    checkQuantitativeFieldsPresent(input.module, input.items),
    checkSpecificNumbersPresent(input.module, input.items),
    checkObservationsActioned(input.openObservationCount),
    checkFactsResolved(input.proposedFactCount),
    checkPhotosAttached(input.module, input.items),
  ];
}

export function qaChecklistPasses(results: readonly QaCheckResult[]): boolean {
  return results.every((result) => result.passed);
}
