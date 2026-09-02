import { z } from "zod";
import { timestampSchema, uuidSchema } from "@/lib/db/common";

/** supabase/migrations/0001_init.sql — append-only, enforced by RLS (no update/delete policy exists). */
export const auditLogRowSchema = z.object({
  id: uuidSchema,
  actor_id: uuidSchema.nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  created_at: timestampSchema,
});
export type AuditLogRow = z.infer<typeof auditLogRowSchema>;
