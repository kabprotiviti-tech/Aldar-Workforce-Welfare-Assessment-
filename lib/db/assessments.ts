import { z } from "zod";
import { COMPLIANCE_RATINGS, QUESTION_ANSWERS, RISK_RATINGS } from "@/lib/rules/constants";
import { dateSchema, dbModuleSchema, timestampSchema, uuidSchema } from "@/lib/db/common";

/**
 * These reuse the exact fixed-vocabulary values from lib/rules/constants —
 * the same rating strings the rule engine validates and computes with,
 * now also the database's own check-constraint values. One vocabulary,
 * enforced at both boundaries.
 */
export const dbComplianceRatingSchema = z.enum(COMPLIANCE_RATINGS);
export const dbQuestionAnswerSchema = z.enum(QUESTION_ANSWERS);
export const dbRiskRatingSchema = z.enum(RISK_RATINGS);

export const assessmentTypeSchema = z.enum(["initial", "follow_up"]);
export type AssessmentType = z.infer<typeof assessmentTypeSchema>;

export const assessmentStageSchema = z.enum([
  "plan",
  "request",
  "collect",
  "review",
  "assess",
  "report",
  "act",
  "monitor",
]);
export type AssessmentStage = z.infer<typeof assessmentStageSchema>;

export const assessmentStatusSchema = z.enum(["draft", "active", "on_hold", "completed", "cancelled"]);
export type AssessmentStatus = z.infer<typeof assessmentStatusSchema>;

export const assessmentRowSchema = z.object({
  id: uuidSchema,
  module: dbModuleSchema,
  cycle_id: uuidSchema,
  entity_id: uuidSchema,
  facility_id: uuidSchema.nullable(),
  template_id: uuidSchema,
  subject_code: z.string(),
  /** Whole numbers for a full audit; +.5 for a follow-up (lib/scheduling/subject-code.ts). */
  audit_number: z.number(),
  assessment_type: assessmentTypeSchema,
  stage: assessmentStageSchema,
  status: assessmentStatusSchema,
  owner_id: uuidSchema.nullable(),
  previous_assessment_id: uuidSchema.nullable(),
  proposed_visit_date: dateSchema.nullable(),
  confirmed_visit_date: dateSchema.nullable(),
  actual_visit_date: dateSchema.nullable(),
  /** True only when the assessed facility sits under a regulatory body requiring visit permission. */
  permission_required: z.boolean(),
  /** Stored once (lib/scheduling/working-days.ts), never recomputed on read. */
  report_due_date: dateSchema.nullable(),
  qa_completed_at: timestampSchema.nullable(),
  approved_at: timestampSchema.nullable(),
  issued_at: timestampSchema.nullable(),
  risk_rating: dbRiskRatingSchema.nullable(),
  overall_compliance_pct: z.number().nullable(),
  adjusted_compliance_pct: z.number().nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type AssessmentRow = z.infer<typeof assessmentRowSchema>;

export const assessmentItemRowSchema = z.object({
  id: uuidSchema,
  assessment_id: uuidSchema,
  requirement_id: uuidSchema,
  compliance_status: dbComplianceRatingSchema.nullable(),
  remarks: z.string().nullable(),
  action_required: z.string().nullable(),
  was_assessed: z.boolean(),
  carried_forward_from_item_id: uuidSchema.nullable(),
  decided_by: uuidSchema.nullable(),
  decided_at: timestampSchema.nullable(),
  locked: z.boolean(),
  /** Accommodation's mandatory per-area quantitative fields — see lib/db/accommodation-quantitative.ts. */
  quantitative: z.unknown().nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
});
export type AssessmentItemRow = z.infer<typeof assessmentItemRowSchema>;

export const assessmentAnswerRowSchema = z.object({
  id: uuidSchema,
  assessment_item_id: uuidSchema,
  question_id: uuidSchema,
  answer: dbQuestionAnswerSchema.nullable(),
  remark: z.string().nullable(),
  action_required: z.string().nullable(),
  quantitative: z.unknown().nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
});
export type AssessmentAnswerRow = z.infer<typeof assessmentAnswerRowSchema>;
