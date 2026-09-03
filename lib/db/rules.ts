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
  /** 0022_rule_engine.sql — an edit supersedes with a new version rather than mutating; at most one version per code is active. */
  version: z.number().int(),
  title: z.string().nullable(),
  explanation_template: z.string().nullable(),
  /** The assessor-entered fields this rule reads, alongside input_fact_keys (read from fact_ledger_confirmed). */
  quantitative_keys: z.array(z.string()),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type RuleDefinitionRow = z.infer<typeof ruleDefinitionRowSchema>;

export const ruleEvaluationResultSchema = z.enum(["pass", "fail", "insufficient_data"]);
export type RuleEvaluationResult = z.infer<typeof ruleEvaluationResultSchema>;

/**
 * One run of the rule engine. Append-only — a re-evaluation is a new row.
 *
 * 0022_rule_engine.sql adds the stamps that make a stored result
 * reproducible on its own: which definition version produced it, the
 * thresholds and citation it was computed against, what it observed, and
 * — for insufficient_data — which inputs were missing.
 */
export const ruleEvaluationRowSchema = z.object({
  id: uuidSchema,
  assessment_item_id: uuidSchema,
  rule_code: z.string(),
  rule_definition_id: uuidSchema.nullable(),
  rule_version: z.number().int().nullable(),
  /** Which specific room, vehicle or agreement this run was about. Null when the rule evaluates the item as a whole. */
  subject_ref: z.string().nullable(),
  inputs: z.unknown(),
  observed: z.unknown().nullable(),
  thresholds: z.unknown().nullable(),
  legal_reference: z.string().nullable(),
  result: ruleEvaluationResultSchema,
  computed_explanation: z.string().nullable(),
  missing_fact_keys: z.array(z.string()),
  evaluated_by: uuidSchema.nullable(),
  evaluated_at: timestampSchema,
});
export type RuleEvaluationRow = z.infer<typeof ruleEvaluationRowSchema>;

/**
 * 0032_scoring_weights.sql — the compliance-percentage weights, versioned
 * the same way rule_definitions is: an edit supersedes with a new
 * version rather than mutating; at most one version is active; a
 * version referenced by a report is immutable except `active`.
 */
export const scoringWeightsRowSchema = z.object({
  id: uuidSchema,
  version: z.number().int(),
  compliant_weight: z.number(),
  partial_weight: z.number(),
  not_compliant_weight: z.number(),
  active: z.boolean(),
  created_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type ScoringWeightsRow = z.infer<typeof scoringWeightsRowSchema>;

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
