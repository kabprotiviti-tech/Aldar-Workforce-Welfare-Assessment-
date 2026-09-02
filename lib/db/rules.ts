import { z } from "zod";
import { dbModuleSchema, timestampSchema, uuidSchema } from "@/lib/db/common";

export const ruleDefinitionRowSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  module: dbModuleSchema,
  requirement_id: uuidSchema,
  description: z.string().nullable(),
  input_fact_keys: z.array(z.string()),
  threshold: z.unknown().nullable(),
  legal_reference: z.string().nullable(),
  active: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type RuleDefinitionRow = z.infer<typeof ruleDefinitionRowSchema>;

export const ruleEvaluationResultSchema = z.enum(["pass", "fail", "insufficient_data"]);
export type RuleEvaluationResult = z.infer<typeof ruleEvaluationResultSchema>;

/** One run of the rule engine. Append-only — a re-evaluation is a new row. */
export const ruleEvaluationRowSchema = z.object({
  id: uuidSchema,
  assessment_item_id: uuidSchema,
  rule_code: z.string(),
  inputs: z.unknown(),
  result: ruleEvaluationResultSchema,
  computed_explanation: z.string().nullable(),
  evaluated_at: timestampSchema,
});
export type RuleEvaluationRow = z.infer<typeof ruleEvaluationRowSchema>;

export const roomSourceSchema = z.enum(["drawing", "manual", "both"]);
export type RoomSource = z.infer<typeof roomSourceSchema>;

export const roomRowSchema = z.object({
  id: uuidSchema,
  facility_id: uuidSchema,
  room_ref: z.string(),
  drawing_area_m2: z.number().nullable(),
  drawing_source_file_id: uuidSchema.nullable(),
  measured_area_m2: z.number().nullable(),
  bed_count: z.number().int().nullable(),
  occupancy_count: z.number().int().nullable(),
  /** Generated column — measured_area_m2 (or drawing_area_m2) / occupancy_count. Never set directly. */
  computed_m2_per_person: z.number().nullable(),
  source: roomSourceSchema,
  confirmed_by: uuidSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type RoomRow = z.infer<typeof roomRowSchema>;

/** requirement_id doubles as "area_id" for the Accommodation module. */
export const photoRowSchema = z.object({
  id: uuidSchema,
  assessment_id: uuidSchema,
  requirement_id: uuidSchema.nullable(),
  storage_path: z.string(),
  captured_at: timestampSchema.nullable(),
  geo_lat: z.number().nullable(),
  geo_lng: z.number().nullable(),
  caption: z.string().nullable(),
  analysis_id: uuidSchema.nullable(),
  uploaded_by: uuidSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type PhotoRow = z.infer<typeof photoRowSchema>;
