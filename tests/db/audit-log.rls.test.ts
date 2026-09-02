import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves, against a real Postgres instance, that public.audit_log is
 * append-only: an `authenticated` role with full table-level UPDATE/DELETE
 * grants still cannot change or remove a row, because no RLS policy
 * permits either command (supabase/migrations/0001_init.sql).
 *
 * Requires a reachable Postgres — set TEST_DATABASE_URL, or run a local one
 * (see docs/decisions.md for how this was set up and verified). Skips
 * cleanly, rather than failing the whole suite, when none is reachable.
 */
const ADMIN_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres_test_pw@127.0.0.1:5432/wwap_test";

const AUTHENTICATED_DATABASE_URL = ADMIN_DATABASE_URL.replace(
  /\/\/[^@]+@/,
  "//authenticated:authenticated_test_pw@",
);

const adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });

async function isReachable(): Promise<boolean> {
  try {
    await adminPool.query("select 1");
    return true;
  } catch {
    return false;
  }
}

const reachable = await isReachable();

if (!reachable) {
  // eslint-disable-next-line no-console
  console.warn(
    `Skipping audit_log RLS test — no Postgres reachable at ${ADMIN_DATABASE_URL}. ` +
      "Set TEST_DATABASE_URL to point at one to run it.",
  );
}

describe.skipIf(!reachable)("public.audit_log is append-only (Postgres RLS)", () => {
  let authenticatedPool: Pool;
  let rowId: string;

  beforeAll(async () => {
    await adminPool.query(readFileSync(join(process.cwd(), "tests/db/local-setup.sql"), "utf8"));
    await adminPool.query("drop schema if exists public cascade; create schema public;");
    await adminPool.query(
      "grant usage on schema public to anon, authenticated, service_role;",
    );
    await adminPool.query(
      readFileSync(join(process.cwd(), "supabase/migrations/0001_init.sql"), "utf8"),
    );

    const inserted = await adminPool.query<{ id: string }>(
      `insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
       values (null, 'create', 'requirement_assessment', 'demo-1', null, '{"rating":"Compliant"}'::jsonb)
       returning id`,
    );
    rowId = inserted.rows[0]!.id;

    authenticatedPool = new Pool({ connectionString: AUTHENTICATED_DATABASE_URL });
  });

  afterAll(async () => {
    await authenticatedPool?.end();
    await adminPool.end();
  });

  it("lets an authenticated actor read the row", async () => {
    const result = await authenticatedPool.query("select action from public.audit_log where id = $1", [
      rowId,
    ]);
    expect(result.rows).toEqual([{ action: "create" }]);
  });

  it("denies UPDATE even though the role holds table-level UPDATE privilege", async () => {
    const update = await authenticatedPool.query(
      "update public.audit_log set action = 'tampered' where id = $1 returning id",
      [rowId],
    );
    expect(update.rowCount).toBe(0);

    const unchanged = await adminPool.query("select action from public.audit_log where id = $1", [rowId]);
    expect(unchanged.rows[0]?.action).toBe("create");
  });

  it("denies DELETE even though the role holds table-level DELETE privilege", async () => {
    const del = await authenticatedPool.query("delete from public.audit_log where id = $1 returning id", [
      rowId,
    ]);
    expect(del.rowCount).toBe(0);

    const stillThere = await adminPool.query("select count(*)::int as count from public.audit_log where id = $1", [
      rowId,
    ]);
    expect(stillThere.rows[0]?.count).toBe(1);
  });
});
