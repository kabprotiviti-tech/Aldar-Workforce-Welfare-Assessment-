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

/**
 * 0029_finding_lifecycle.sql — "accept closure, or reject with reason and
 * a new due date." Two outcomes, not a spectrum: there is no third value
 * for a partial closure, which is how "partial closure is explicitly not
 * acceptance" is enforced — there's nothing to write for it.
 */
export const findingReviewerDecisionSchema = z.enum(["accepted", "rejected"]);
export type FindingReviewerDecision = z.infer<typeof findingReviewerDecisionSchema>;

export const findingRowSchema = z.object({
  id: uuidSchema,
  assessment_item_id: uuidSchema,
  entity_id: uuidSchema,
  facility_id: uuidSchema.nullable(),
  title: z.string(),
  priority: findingPrioritySchema,
  owner_name: z.string().nullable(),
  owner_email: z.string().nullable(),
  /** 0029_finding_lifecycle.sql — free-text; the owner is often a contractor with no entity_contacts row. */
  owner_organisation: z.string().nullable(),
  /** 0029_finding_lifecycle.sql — set only when the owner is a known entity contact; required to issue a closure portal link. */
  owner_contact_id: uuidSchema.nullable(),
  due_date: dateSchema.nullable(),
  status: findingStatusSchema,
  /** The owner's note, written alongside their closure evidence upload — not the evidence itself (see evidence_files.finding_id). */
  closure_evidence_text: z.string().nullable(),
  reviewer_decision: findingReviewerDecisionSchema.nullable(),
  reviewer_decision_reason: z.string().nullable(),
  reviewer_decision_at: timestampSchema.nullable(),
  reviewer_decision_by: uuidSchema.nullable(),
  closed_at: timestampSchema.nullable(),
  repeat_of_finding_id: uuidSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type FindingRow = z.infer<typeof findingRowSchema>;

/**
 * Internal history behind a finding — staff-only, never exposed to a
 * client_viewer. event_type stays free text at the database layer, the
 * same "fixed vocabulary enforced at the app boundary" treatment as
 * evidence_files.document_class — lib/findings/lifecycle.ts's
 * FINDING_EVENT_TYPES is that vocabulary.
 */
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
  /** 0030_governance.sql — the report's own content, not just a pointer to the Storage file. See lib/reports/snapshot.ts. */
  snapshot: z.unknown(),
  /** 0032_scoring_weights.sql — which weights version produced this report's Risk/Overall/Adjusted figures. */
  scoring_weights_id: uuidSchema.nullable(),
  generated_at: timestampSchema,
  generated_by: uuidSchema.nullable(),
  is_current: z.boolean(),
});
export type ReportRow = z.infer<typeof reportRowSchema>;
