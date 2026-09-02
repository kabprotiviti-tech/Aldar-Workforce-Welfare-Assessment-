import { z } from "zod";
import { timestampSchema, uuidSchema } from "@/lib/db/common";

/** 0019_extraction_jobs.sql — the document-extraction batch queue. */
export const extractionJobStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);
export type ExtractionJobStatus = z.infer<typeof extractionJobStatusSchema>;

export const extractionJobRowSchema = z.object({
  id: uuidSchema,
  batch_id: uuidSchema,
  evidence_file_id: uuidSchema,
  status: extractionJobStatusSchema,
  error: z.string().nullable(),
  extraction_id: uuidSchema.nullable(),
  created_at: timestampSchema,
  started_at: timestampSchema.nullable(),
  finished_at: timestampSchema.nullable(),
  created_by: uuidSchema.nullable(),
});
export type ExtractionJobRow = z.infer<typeof extractionJobRowSchema>;
