import { z } from "zod";
import { timestampSchema, uuidSchema } from "@/lib/db/common";

export const organisationRowSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type OrganisationRow = z.infer<typeof organisationRowSchema>;

export const userRoleSchema = z.enum(["admin", "assessor", "qa_reviewer", "client_viewer"]);
export type UserRole = z.infer<typeof userRoleSchema>;

/** Extends auth.users (Supabase-managed) — supabase/migrations/0001_init.sql, 0002_core.sql. */
export const userRowSchema = z.object({
  id: uuidSchema,
  full_name: z.string(),
  role: userRoleSchema,
  organisation_id: uuidSchema.nullable(),
  /** Set only for client_viewer; identifies which entity they may see. */
  entity_id: uuidSchema.nullable(),
  active: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type UserRow = z.infer<typeof userRowSchema>;

export const entityTypeSchema = z.enum([
  "general_contractor",
  "facilities_management",
  "asset_operator",
  "subcontractor",
]);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const entityStatusSchema = z.enum(["active", "inactive"]);
export type EntityStatus = z.infer<typeof entityStatusSchema>;

export const entityRowSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  entity_code: z.string(),
  type: entityTypeSchema,
  worker_count: z.number().int().nullable(),
  project_name: z.string().nullable(),
  project_type: z.string().nullable(),
  status: entityStatusSchema,
  first_onboarded_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type EntityRow = z.infer<typeof entityRowSchema>;

export const entityContactRowSchema = z.object({
  id: uuidSchema,
  entity_id: uuidSchema,
  name: z.string(),
  role: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  is_primary: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type EntityContactRow = z.infer<typeof entityContactRowSchema>;

export const facilityRowSchema = z.object({
  id: uuidSchema,
  entity_id: uuidSchema,
  name: z.string(),
  facility_code: z.string(),
  emirate: z.string().nullable(),
  area: z.string().nullable(),
  capacity: z.number().int().nullable(),
  regulatory_body: z.string().nullable(),
  access_permission_required: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type FacilityRow = z.infer<typeof facilityRowSchema>;

export const cycleRowSchema = z.object({
  id: uuidSchema,
  year: z.number().int(),
  name: z.string(),
  opened_at: timestampSchema,
  closed_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  deleted_at: timestampSchema.nullable(),
});
export type CycleRow = z.infer<typeof cycleRowSchema>;
