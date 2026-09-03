import { z } from "zod";
import { validateRatedEntity } from "@/lib/rules/validation";
import type { ComplianceRating } from "@/lib/rules/constants";

/**
 * The assessment decision: what an assessor must supply alongside a
 * status, and whether a requirement is finished.
 *
 * The remark and closure-action rules themselves are not re-implemented
 * here — they are lib/rules/validation.ts's validateRatedEntity, built in
 * the first phase of this project and unit tested there. This module adds
 * what the screen needs on top: naming the requirement in the message
 * (this prompt), and turning a list of items into the navigation's
 * completion state.
 */

/** "The report must contain numbers, not adjectives" (this prompt). */
export const evidenceDetailSchema = z.object({
  /** e.g. the salary transfer dates actually seen in the WPS file. */
  salaryTransferDates: z.array(z.string().min(1)).default([]),
  /** Concrete deductions seen, with the amount — not "some deductions noted". */
  deductionExamples: z
    .array(
      z.object({
        type: z.string().min(1),
        amountAed: z.number().nonnegative().nullable(),
        note: z.string().nullable(),
      }),
    )
    .default([]),
  /** What was sampled out of what: "12 of 120 payslips", not "a sample". */
  sampleSizes: z
    .array(
      z.object({
        label: z.string().min(1),
        sampled: z.number().int().nonnegative(),
        population: z.number().int().nonnegative(),
      }),
    )
    .default([]),
});
export type EvidenceDetail = z.infer<typeof evidenceDetailSchema>;

export const EMPTY_EVIDENCE_DETAIL: EvidenceDetail = { salaryTransferDates: [], deductionExamples: [], sampleSizes: [] };

/** Reads stored jsonb back, tolerating a null or a shape from an older version. */
export function parseEvidenceDetail(raw: unknown): EvidenceDetail {
  const parsed = evidenceDetailSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_EVIDENCE_DETAIL;
}

/** One requirement's decision, as the page holds it. */
export interface ItemDecision {
  requirementSlNo: number;
  requirementTitle: string;
  isKey: boolean;
  status: ComplianceRating | null;
  remarks: string | null;
  actionRequired: string | null;
}

export interface DecisionIssue {
  requirementSlNo: number;
  field: "status" | "remark" | "actionRequiredForClosure";
  /** Names the requirement, so a validation message read on its own still says which one (this prompt). */
  message: string;
}

/**
 * Whether one requirement's decision can be submitted. A missing status
 * is an issue in its own right: an unrated requirement is not a finished
 * one, and the aggregate percentages would silently exclude it.
 */
export function validateItemDecision(item: ItemDecision): DecisionIssue[] {
  const label = `Requirement ${item.requirementSlNo} (${item.requirementTitle})`;

  if (item.status === null) {
    return [{ requirementSlNo: item.requirementSlNo, field: "status", message: `${label} has no compliance status yet.` }];
  }

  return validateRatedEntity({ rating: item.status, remark: item.remarks, actionRequiredForClosure: item.actionRequired }).map((issue) => ({
    requirementSlNo: item.requirementSlNo,
    field: issue.field,
    message: `${label}: ${issue.message}`,
  }));
}

/** Every issue across an assessment, in requirement order — what blocks submission. */
export function validateAssessment(items: readonly ItemDecision[]): DecisionIssue[] {
  return [...items]
    .sort((a, b) => a.requirementSlNo - b.requirementSlNo)
    .flatMap((item) => validateItemDecision(item));
}

export type ItemCompletion = "not_started" | "incomplete" | "complete";

/**
 * The navigation's per-requirement state. `incomplete` is the one worth
 * distinguishing: a status has been chosen but the remark or closure
 * action the rules require is still missing, which is exactly the state
 * an assessor loses track of across 23 requirements.
 */
export function completionOf(item: ItemDecision): ItemCompletion {
  if (item.status === null) return "not_started";
  return validateItemDecision(item).length === 0 ? "complete" : "incomplete";
}

export interface AssessmentProgress {
  total: number;
  complete: number;
  incomplete: number;
  notStarted: number;
  /** Key requirements still without a status — the ones that drive the risk rating. */
  keyOutstanding: number;
}

export function assessmentProgress(items: readonly ItemDecision[]): AssessmentProgress {
  const states = items.map((item) => completionOf(item));
  return {
    total: items.length,
    complete: states.filter((state) => state === "complete").length,
    incomplete: states.filter((state) => state === "incomplete").length,
    notStarted: states.filter((state) => state === "not_started").length,
    keyOutstanding: items.filter((item) => item.isKey && item.status === null).length,
  };
}

/**
 * The statement this prompt requires on the page. A constant so the page
 * and the tests say it identically, and so it can't drift into a softer
 * wording later.
 */
export const ASSESSOR_DECISION_STATEMENT = "Final assessment decisions are made by the assessor.";
