import { z } from "zod";
import { dateSchema, timestampSchema, uuidSchema } from "@/lib/db/common";

/** 0017_evidence_review_and_requirements.sql — the assessor's review workflow for one uploaded file. */
export const evidenceReviewStatusSchema = z.enum(["outstanding", "received", "in_review", "reviewed", "gap_flagged"]);
export type EvidenceReviewStatus = z.infer<typeof evidenceReviewStatusSchema>;

export const virusScanStatusSchema = z.enum(["pending", "clean", "infected", "error"]);
export type VirusScanStatus = z.infer<typeof virusScanStatusSchema>;

export const evidenceFileRowSchema = z.object({
  id: uuidSchema,
  assessment_id: uuidSchema,
  /** 0015_evidence_files_rfi_and_nda.sql — the requirement this file evidences, when known. */
  requirement_id: uuidSchema.nullable(),
  /** The RFI checklist line this file was uploaded against, if any. */
  rfi_checklist_item_id: uuidSchema.nullable(),
  storage_path: z.string(),
  original_name: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().int(),
  document_class: z.string().nullable(),
  /** Exactly one of uploaded_by/uploaded_by_contact_id is set — see docs/decisions.md. */
  uploaded_by: uuidSchema.nullable(),
  uploaded_by_contact_id: uuidSchema.nullable(),
  uploaded_at: timestampSchema,
  review_status: evidenceReviewStatusSchema,
  virus_scan_status: virusScanStatusSchema,
  virus_scanned_at: timestampSchema.nullable(),
  updated_at: timestampSchema,
});
export type EvidenceFileRow = z.infer<typeof evidenceFileRowSchema>;

/**
 * evidence_files.document_class stays free text at the database layer
 * (like questions.answer_type — "left unconstrained rather than guessing
 * a full enum," 0003_templates.sql) because two administrative sentinel
 * values already use the same column ("access_letter", "rfi_upload") that
 * aren't part of this business-classification vocabulary. This is the
 * fixed vocabulary lib/evidence/classify.ts proposes from and the
 * evidence library's dropdown is scoped to — enforced at the app
 * boundary, not the database. See docs/decisions.md.
 */
export const documentClassSchema = z.enum([
  "wps_report",
  "payroll_register",
  "employment_contract",
  "recruitment_agreement",
  "passport_register",
  "insurance_schedule",
  "accommodation_contract",
  "civil_defence_certificate",
  "occupancy_schedule",
  "approved_drawing",
  "worker_register",
  "induction_register",
  "vehicle_registration",
  "photo",
]);
export type DocumentClass = z.infer<typeof documentClassSchema>;

/** 0017_evidence_review_and_requirements.sql — the assessor-editable set of requirements one file counts as evidence for. */
export const evidenceFileRequirementRowSchema = z.object({
  evidence_file_id: uuidSchema,
  requirement_id: uuidSchema,
  created_at: timestampSchema,
  created_by: uuidSchema.nullable(),
});
export type EvidenceFileRequirementRow = z.infer<typeof evidenceFileRequirementRowSchema>;

/** What the model returned for one evidence file. Immutable once written. */
export const extractionRowSchema = z.object({
  id: uuidSchema,
  evidence_file_id: uuidSchema,
  model: z.string(),
  prompt_version: z.string(),
  raw_response: z.unknown().nullable(),
  input_tokens: z.number().int().nullable(),
  output_tokens: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  created_at: timestampSchema,
  error: z.string().nullable(),
});
export type ExtractionRow = z.infer<typeof extractionRowSchema>;

export const extractedFactStatusSchema = z.enum(["proposed", "accepted", "edited", "rejected"]);
export type ExtractedFactStatus = z.infer<typeof extractedFactStatusSchema>;

/** 0018_extracted_facts_shape.sql — the document extraction service's fixed confidence vocabulary. */
export const factConfidenceSchema = z.enum(["high", "medium", "low"]);
export type FactConfidence = z.infer<typeof factConfidenceSchema>;

export const factAbsenceReasonSchema = z.enum(["not_present", "illegible"]);
export type FactAbsenceReason = z.infer<typeof factAbsenceReasonSchema>;

export const extractedFactRowSchema = z.object({
  id: uuidSchema,
  extraction_id: uuidSchema,
  evidence_file_id: uuidSchema,
  fact_key: z.string(),
  value_text: z.string().nullable(),
  value_number: z.number().nullable(),
  value_date: dateSchema.nullable(),
  value_boolean: z.boolean().nullable(),
  /** List-valued facts (e.g. payroll_deduction_types) — the one shape the other four value_* columns don't cover. */
  value_json: z.unknown().nullable(),
  unit: z.string().nullable(),
  page_ref: z.string().nullable(),
  verbatim_quote: z.string().nullable(),
  confidence: factConfidenceSchema.nullable(),
  /** Set exactly when every value_* column is null — this prompt's {"value": null, "reason": "not_present" | "illegible"} contract. */
  reason: factAbsenceReasonSchema.nullable(),
  status: extractedFactStatusSchema,
  resolved_by: uuidSchema.nullable(),
  resolved_at: timestampSchema.nullable(),
  resolved_value_json: z.unknown().nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type ExtractedFactRow = z.infer<typeof extractedFactRowSchema>;

export const aiObservationKindSchema = z.enum(["evidence_identified", "potential_gap", "requires_attention"]);
export type AiObservationKind = z.infer<typeof aiObservationKindSchema>;

export const aiObservationStatusSchema = z.enum(["open", "confirmed", "rejected", "noted"]);
export type AiObservationStatus = z.infer<typeof aiObservationStatusSchema>;

export const aiObservationRowSchema = z.object({
  id: uuidSchema,
  assessment_item_id: uuidSchema,
  kind: aiObservationKindSchema,
  title: z.string(),
  body: z.string().nullable(),
  source_ref: z.string().nullable(),
  evidence_file_id: uuidSchema.nullable(),
  status: aiObservationStatusSchema,
  actioned_by: uuidSchema.nullable(),
  actioned_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type AiObservationRow = z.infer<typeof aiObservationRowSchema>;
