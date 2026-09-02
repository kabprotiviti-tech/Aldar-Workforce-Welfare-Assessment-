import { z } from "zod";
import { dateSchema, dbModuleSchema, timestampSchema, uuidSchema } from "@/lib/db/common";

export const rfiDocumentTemplateRowSchema = z.object({
  id: uuidSchema,
  module: dbModuleSchema,
  name: z.string(),
  description: z.string().nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type RfiDocumentTemplateRow = z.infer<typeof rfiDocumentTemplateRowSchema>;

export const rfiDocumentTemplateRequirementRowSchema = z.object({
  document_template_id: uuidSchema,
  requirement_id: uuidSchema,
});
export type RfiDocumentTemplateRequirementRow = z.infer<typeof rfiDocumentTemplateRequirementRowSchema>;

export const rfiRequestStatusSchema = z.enum(["open", "completed", "expired", "cancelled"]);
export type RfiRequestStatus = z.infer<typeof rfiRequestStatusSchema>;

export const rfiRequestRowSchema = z.object({
  id: uuidSchema,
  assessment_id: uuidSchema,
  contact_id: uuidSchema,
  status: rfiRequestStatusSchema,
  issued_at: timestampSchema,
  due_date: dateSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type RfiRequestRow = z.infer<typeof rfiRequestRowSchema>;

export const rfiChecklistItemStatusSchema = z.enum(["outstanding", "received", "waived"]);
export type RfiChecklistItemStatus = z.infer<typeof rfiChecklistItemStatusSchema>;

export const rfiChecklistItemRowSchema = z.object({
  id: uuidSchema,
  rfi_request_id: uuidSchema,
  document_template_id: uuidSchema.nullable(),
  requirement_id: uuidSchema,
  name: z.string(),
  status: rfiChecklistItemStatusSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type RfiChecklistItemRow = z.infer<typeof rfiChecklistItemRowSchema>;

/** Never read back by the app beyond existence checks — the raw token is never stored, only its hash. */
export const rfiTokenRowSchema = z.object({
  id: uuidSchema,
  rfi_request_id: uuidSchema,
  token_hash: z.string(),
  expires_at: timestampSchema,
  revoked_at: timestampSchema.nullable(),
  last_used_at: timestampSchema.nullable(),
  created_at: timestampSchema,
});
export type RfiTokenRow = z.infer<typeof rfiTokenRowSchema>;

export const rfiTokenAccessOutcomeSchema = z.enum(["success", "invalid", "expired", "revoked", "rate_limited"]);
export type RfiTokenAccessOutcome = z.infer<typeof rfiTokenAccessOutcomeSchema>;

export const rfiTokenAccessLogRowSchema = z.object({
  id: uuidSchema,
  token_hash: z.string(),
  ip: z.string().nullable(),
  outcome: rfiTokenAccessOutcomeSchema,
  created_at: timestampSchema,
});
export type RfiTokenAccessLogRow = z.infer<typeof rfiTokenAccessLogRowSchema>;

export const rfiReminderKindSchema = z.enum(["due_minus_3", "due_date", "overdue"]);
export type RfiReminderKind = z.infer<typeof rfiReminderKindSchema>;

export const rfiReminderSentRowSchema = z.object({
  id: uuidSchema,
  rfi_request_id: uuidSchema,
  kind: rfiReminderKindSchema,
  sent_at: timestampSchema,
});
export type RfiReminderSentRow = z.infer<typeof rfiReminderSentRowSchema>;
