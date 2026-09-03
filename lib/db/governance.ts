import { z } from "zod";
import { timestampSchema, uuidSchema } from "@/lib/db/common";

/** 0030_governance.sql — a QA reviewer's query against one specific requirement. */
export const qaQueryStatusSchema = z.enum(["open", "resolved"]);
export type QaQueryStatus = z.infer<typeof qaQueryStatusSchema>;

export const qaQueryRowSchema = z.object({
  id: uuidSchema,
  assessment_id: uuidSchema,
  assessment_item_id: uuidSchema,
  query_text: z.string(),
  status: qaQueryStatusSchema,
  raised_by: uuidSchema,
  raised_at: timestampSchema,
  resolution_note: z.string().nullable(),
  resolved_by: uuidSchema.nullable(),
  resolved_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type QaQueryRow = z.infer<typeof qaQueryRowSchema>;

/** 0030_governance.sql — one row per formal revision, anchoring exactly which report row was version n before it opened. */
export const assessmentRevisionRowSchema = z.object({
  id: uuidSchema,
  assessment_id: uuidSchema,
  revision_number: z.number().int(),
  reason: z.string(),
  preserved_report_id: uuidSchema,
  revised_by: uuidSchema,
  revised_at: timestampSchema,
});
export type AssessmentRevisionRow = z.infer<typeof assessmentRevisionRowSchema>;
