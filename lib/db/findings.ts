import { z } from "zod";
import { dateSchema, timestampSchema, uuidSchema } from "@/lib/db/common";

export const findingPrioritySchema = z.enum(["high", "medium", "low"]);
export type FindingPriority = z.infer<typeof findingPrioritySchema>;

export const findingStatusSchema = z.enum([
  "open",
  "in_progress",
  "evidence_submitted",
  "under_review",
  "closed",
]);
export type FindingStatus = z.infer<typeof findingStatusSchema>;

export const findingRowSchema = z.object({
  id: uuidSchema,
  assessment_item_id: uuidSchema,
  entity_id: uuidSchema,
  facility_id: uuidSchema.nullable(),
  title: z.string(),
  priority: findingPrioritySchema,
  owner_name: z.string().nullable(),
  owner_email: z.string().nullable(),
  due_date: dateSchema.nullable(),
  status: findingStatusSchema,
  closure_evidence_text: z.string().nullable(),
  reviewer_decision: z.string().nullable(),
  closed_at: timestampSchema.nullable(),
  repeat_of_finding_id: uuidSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type FindingRow = z.infer<typeof findingRowSchema>;

/** Internal history behind a finding — staff-only, never exposed to a client_viewer. */
export const findingEventRowSchema = z.object({
  id: uuidSchema,
  finding_id: uuidSchema,
  event_type: z.string(),
  note: z.string().nullable(),
  actor_id: uuidSchema.nullable(),
  created_at: timestampSchema,
});
export type FindingEventRow = z.infer<typeof findingEventRowSchema>;

export const reportRowSchema = z.object({
  id: uuidSchema,
  assessment_id: uuidSchema,
  version: z.number().int(),
  format: z.string(),
  storage_path: z.string(),
  generated_at: timestampSchema,
  generated_by: uuidSchema.nullable(),
  is_current: z.boolean(),
});
export type ReportRow = z.infer<typeof reportRowSchema>;
