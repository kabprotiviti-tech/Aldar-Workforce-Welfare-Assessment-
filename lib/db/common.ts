import { z } from "zod";

/**
 * Shared primitives for the DB-row Zod schemas in this directory. Field
 * names are snake_case throughout, matching the columns exactly (and what
 * supabase-js actually returns) — this is a different convention from
 * lib/rules/types.ts, whose camelCase types are application-domain shapes,
 * not raw rows. See docs/decisions.md.
 */
export const uuidSchema = z.string().uuid();
/** ISO 8601 timestamptz, as returned over PostgREST. */
export const timestampSchema = z.string();
/** ISO 8601 date (YYYY-MM-DD), as returned over PostgREST. */
export const dateSchema = z.string();

/**
 * The DB's `module` vocabulary (full words) is a different, unreconciled
 * vocabulary from lib/rules/constants.ts's MODULES ("EP"/"ONB"/"ACM", used
 * for report subject-code formatting) — both name the same three modules
 * for different purposes. See docs/decisions.md.
 */
export const dbModuleSchema = z.enum(["employment_practices", "onboarding", "accommodation"]);
export type DbModule = z.infer<typeof dbModuleSchema>;
