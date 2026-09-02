import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";

export const ADMIN_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres_test_pw@127.0.0.1:5432/wwap_test";

export function authenticatedDatabaseUrl(adminUrl: string = ADMIN_DATABASE_URL): string {
  return adminUrl.replace(/\/\/[^@]+@/, "//authenticated:authenticated_test_pw@");
}

export async function isReachable(pool: Pool): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}

const MIGRATION_FILES = [
  "supabase/migrations/0001_init.sql",
  "supabase/migrations/0002_core.sql",
  "supabase/migrations/0003_templates.sql",
  "supabase/migrations/0004_assessments.sql",
  "supabase/migrations/0005_evidence_ai.sql",
  "supabase/migrations/0006_rules_measurement.sql",
  "supabase/migrations/0007_findings_reports.sql",
  "supabase/migrations/0008_grants.sql",
  "supabase/migrations/0009_template_immutability.sql",
  "supabase/migrations/0010_seed_checklist_templates_v1.sql",
  "supabase/migrations/0011_assessment_items_quantitative.sql",
  "supabase/migrations/0012_visit_schedule.sql",
  "supabase/migrations/0013_public_holidays.sql",
  "supabase/migrations/0014_rfi.sql",
  "supabase/migrations/0015_evidence_files_rfi_and_nda.sql",
  // 0016_evidence_bucket.sql is deliberately excluded: it operates on
  // storage.buckets/storage.objects, which only exist in a real Supabase
  // project, not this local Postgres stand-in. See docs/decisions.md.
  "supabase/migrations/0017_evidence_review_and_requirements.sql",
];

/**
 * Resets the public schema to empty and re-applies the test auth/role
 * shim (tests/db/local-setup.sql) plus every real migration, in order,
 * unmodified. Every tests/db/*.test.ts file calls this in beforeAll so
 * each starts from the same known-clean state.
 */
export async function resetAndMigrate(pool: Pool): Promise<void> {
  await pool.query(readFileSync(join(process.cwd(), "tests/db/local-setup.sql"), "utf8"));
  await pool.query("drop schema if exists public cascade; create schema public;");
  await pool.query("grant usage on schema public to anon, authenticated, service_role;");
  for (const file of MIGRATION_FILES) {
    await pool.query(readFileSync(join(process.cwd(), file), "utf8"));
  }
}

/**
 * Runs `fn` against a dedicated connection with `request.jwt.claim.sub`
 * set to `userId` for the duration of one transaction — the same GUC
 * Supabase's real auth.uid() reads from a request's JWT, stood in for
 * here (tests/db/local-setup.sql) since there's no live GoTrue issuing
 * real JWTs against a local Postgres.
 */
export async function asUser<T>(
  pool: Pool,
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
