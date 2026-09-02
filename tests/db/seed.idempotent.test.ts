import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SEED_CYCLE,
  SEED_ENTITIES,
  SEED_FACILITIES,
  SEED_ORGANISATION,
  SEED_USERS,
} from "@/lib/seed-data";
import { ADMIN_DATABASE_URL, isReachable, resetAndMigrate } from "./helpers";

/**
 * Proves the seed fixture (lib/seed-data.ts) is idempotent: running the
 * same upsert sequence twice leaves exactly one row per fixture record,
 * never duplicates.
 *
 * scripts/seed.ts itself creates auth users through the Supabase Admin
 * API, which needs a live Supabase project (GoTrue) this environment
 * doesn't have — see docs/decisions.md. What's provable here, and is
 * exactly what scripts/seed.ts does downstream of that API call, is that
 * upserting every public.* row by its fixed id is genuinely idempotent
 * against a real Postgres running the real migrations. auth.users rows
 * are inserted directly (standing in for the Admin API call) using the
 * same fixed ids scripts/seed.ts resolves those emails to.
 */
const pool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(pool);

if (!reachable) {
  // eslint-disable-next-line no-console
  console.warn(`Skipping seed idempotency test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

async function runSeedUpsertSequence() {
  await pool.query("insert into public.organisations (id, name) values ($1, $2) on conflict (id) do update set name = excluded.name", [
    SEED_ORGANISATION.id,
    SEED_ORGANISATION.name,
  ]);

  for (const entity of SEED_ENTITIES) {
    await pool.query(
      `insert into public.entities (id, name, entity_code, type)
       values ($1, $2, $3, $4)
       on conflict (id) do update set name = excluded.name, entity_code = excluded.entity_code, type = excluded.type`,
      [entity.id, entity.name, entity.entity_code, entity.type],
    );
  }

  for (const facility of SEED_FACILITIES) {
    await pool.query(
      `insert into public.facilities (id, entity_id, name, facility_code)
       values ($1, $2, $3, $4)
       on conflict (id) do update set name = excluded.name, facility_code = excluded.facility_code`,
      [facility.id, facility.entity_id, facility.name, facility.facility_code],
    );
  }

  await pool.query(
    `insert into public.cycles (id, year, name) values ($1, $2, $3)
     on conflict (id) do update set year = excluded.year, name = excluded.name`,
    [SEED_CYCLE.id, SEED_CYCLE.year, SEED_CYCLE.name],
  );

  for (const seedUser of SEED_USERS) {
    // Stands in for scripts/seed.ts's Admin-API find-or-create-by-email step.
    await pool.query("insert into auth.users (id) values ($1) on conflict (id) do nothing", [seedUser.id]);

    const entityId = "entity_id" in seedUser ? seedUser.entity_id : null;
    await pool.query(
      `insert into public.users (id, full_name, role, organisation_id, entity_id, active)
       values ($1, $2, $3, $4, $5, true)
       on conflict (id) do update set
         full_name = excluded.full_name, role = excluded.role,
         organisation_id = excluded.organisation_id, entity_id = excluded.entity_id`,
      [seedUser.id, seedUser.full_name, seedUser.role, SEED_ORGANISATION.id, entityId],
    );
  }
}

describe.skipIf(!reachable)("seed fixture is idempotent", () => {
  beforeAll(async () => {
    await resetAndMigrate(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("produces exactly the expected row counts after running twice", async () => {
    await runSeedUpsertSequence();
    await runSeedUpsertSequence();

    const counts = await pool.query<{ table_name: string; count: string }>(
      `select 'organisations' as table_name, count(*) from public.organisations
       union all select 'users', count(*) from public.users
       union all select 'entities', count(*) from public.entities
       union all select 'facilities', count(*) from public.facilities
       union all select 'cycles', count(*) from public.cycles`,
    );

    const byTable = Object.fromEntries(counts.rows.map((row) => [row.table_name, Number(row.count)]));
    expect(byTable).toEqual({
      organisations: 1,
      users: 4,
      entities: 3,
      facilities: 2,
      cycles: 1,
    });
  });

  it("keeps values from the second run, not stale duplicates", async () => {
    const result = await pool.query("select name from public.organisations where id = $1", [
      SEED_ORGANISATION.id,
    ]);
    expect(result.rows[0]?.name).toBe(SEED_ORGANISATION.name);
  });
});
