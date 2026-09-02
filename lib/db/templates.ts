import { z } from "zod";
import { dateSchema, dbModuleSchema, timestampSchema, uuidSchema } from "@/lib/db/common";

export const checklistTemplateRowSchema = z.object({
  id: uuidSchema,
  module: dbModuleSchema,
  version: z.number().int(),
  effective_from: dateSchema,
  is_active: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type ChecklistTemplateRow = z.infer<typeof checklistTemplateRowSchema>;

/** A module's "requirements" double as its assessment areas for Accommodation. */
export const requirementRowSchema = z.object({
  id: uuidSchema,
  template_id: uuidSchema,
  sl_no: z.number().int(),
  title: z.string(),
  is_key: z.boolean(),
  detail_text: z.string().nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type RequirementRow = z.infer<typeof requirementRowSchema>;

export const questionRowSchema = z.object({
  id: uuidSchema,
  requirement_id: uuidSchema,
  code: z.string(),
  text: z.string(),
  answer_type: z.string(),
  requires_quantitative: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type QuestionRow = z.infer<typeof questionRowSchema>;
