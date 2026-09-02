import { z } from "zod";
import { dateSchema, timestampSchema, uuidSchema } from "@/lib/db/common";

/** supabase/migrations/0013_public_holidays.sql — the UAE calendar working-day arithmetic reads from. */
export const publicHolidayRowSchema = z.object({
  id: uuidSchema,
  holiday_date: dateSchema,
  name: z.string(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type PublicHolidayRow = z.infer<typeof publicHolidayRowSchema>;
