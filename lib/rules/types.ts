import { z } from "zod";
import { COMPLIANCE_RATINGS, QUESTION_ANSWERS } from "./constants";
import type { ComplianceRating } from "./constants";

export const questionAnswerSchema = z.enum(QUESTION_ANSWERS);
export const complianceRatingSchema = z.enum(COMPLIANCE_RATINGS);

/**
 * A single worker welfare question, as confirmed by a human assessor.
 * `remark` and `actionRequiredForClosure` are intentionally optional here —
 * whether they are required depends on `answer` and is enforced by
 * lib/rules/validation.ts, never by the shape of the data itself.
 */
export const questionResultSchema = z.object({
  questionId: z.string().min(1),
  answer: questionAnswerSchema,
  remark: z.string().trim().min(1).nullable(),
  actionRequiredForClosure: z.string().trim().min(1).nullable(),
});
export type QuestionResult = z.infer<typeof questionResultSchema>;

/**
 * One of the 23 worker welfare requirements (Employment Practices / Onboarding),
 * as rated by a human assessor for a given assessment cycle.
 */
export const requirementAssessmentSchema = z.object({
  requirementNumber: z.number().int().min(1).max(23),
  rating: complianceRatingSchema,
  remark: z.string().trim().min(1).nullable(),
  actionRequiredForClosure: z.string().trim().min(1).nullable(),
  /** False when this requirement is carried forward from a previous audit rather than assessed this cycle. */
  assessedThisCycle: z.boolean(),
});
export type RequirementAssessment = z.infer<typeof requirementAssessmentSchema>;

/**
 * One of the 12 Accommodation checklist areas, as rated by a human assessor.
 */
export const accommodationAreaAssessmentSchema = z.object({
  areaNumber: z.number().int().min(1).max(12),
  rating: complianceRatingSchema,
  remark: z.string().trim().min(1).nullable(),
  actionRequiredForClosure: z.string().trim().min(1).nullable(),
  assessedThisCycle: z.boolean(),
});
export type AccommodationAreaAssessment = z.infer<typeof accommodationAreaAssessmentSchema>;

/** Shared shape used by validation and aggregation for any requirement/area-level rating. */
export type RatedEntity = {
  rating: ComplianceRating;
  remark: string | null;
  actionRequiredForClosure: string | null;
};

/** A RatedEntity that also tracks whether it was assessed this cycle or carried forward. */
export type CycleRatedEntity = RatedEntity & { assessedThisCycle: boolean };

