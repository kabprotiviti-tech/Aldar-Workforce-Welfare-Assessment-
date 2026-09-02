/**
 * Idempotent fixture seed: one organisation, four users (one per role),
 * three entities, two facilities, one open cycle.
 *
 * Idempotent by construction: every public.* row is upserted by a fixed
 * id from lib/seed-data.ts (onConflict: "id"), and each auth user is
 * looked up by email before creation — re-running this against the same
 * project updates the same rows rather than duplicating them.
 *
 * Run with: npx tsx scripts/seed.ts
 * Requires the same env as the app (see .env.example) — this uses the
 * service-role client, so never point it at a production project.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  SEED_CYCLE,
  SEED_ENTITIES,
  SEED_FACILITIES,
  SEED_ORGANISATION,
  SEED_PASSWORD,
  SEED_USERS,
} from "@/lib/seed-data";

async function findOrCreateAuthUser(email: string): Promise<string> {
  const supabase = createSupabaseAdminClient();

  // No admin.getUserByEmail in supabase-js — page through listUsers and
  // match by email. Four seed users will always fit on the first page,
  // but a real project's user list won't, so this still pages properly.
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);

    const existing = data.users.find((user) => user.email === email);
    if (existing) return existing.id;

    if (data.users.length === 0) break;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: SEED_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createUser(${email}) failed: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

async function main() {
  const supabase = createSupabaseAdminClient();

  const { error: orgError } = await supabase
    .from("organisations")
    .upsert({ id: SEED_ORGANISATION.id, name: SEED_ORGANISATION.name }, { onConflict: "id" });
  if (orgError) throw new Error(`seeding organisation failed: ${orgError.message}`);

  const { error: entitiesError } = await supabase.from("entities").upsert(
    SEED_ENTITIES.map((entity) => ({
      id: entity.id,
      name: entity.name,
      entity_code: entity.entity_code,
      type: entity.type,
    })),
    { onConflict: "id" },
  );
  if (entitiesError) throw new Error(`seeding entities failed: ${entitiesError.message}`);

  const { error: facilitiesError } = await supabase.from("facilities").upsert(
    SEED_FACILITIES.map((facility) => ({
      id: facility.id,
      entity_id: facility.entity_id,
      name: facility.name,
      facility_code: facility.facility_code,
    })),
    { onConflict: "id" },
  );
  if (facilitiesError) throw new Error(`seeding facilities failed: ${facilitiesError.message}`);

  const { error: cycleError } = await supabase
    .from("cycles")
    .upsert({ id: SEED_CYCLE.id, year: SEED_CYCLE.year, name: SEED_CYCLE.name }, { onConflict: "id" });
  if (cycleError) throw new Error(`seeding cycle failed: ${cycleError.message}`);

  for (const seedUser of SEED_USERS) {
    const authUserId = await findOrCreateAuthUser(seedUser.email);

    const { error: userError } = await supabase.from("users").upsert(
      {
        id: authUserId,
        full_name: seedUser.full_name,
        role: seedUser.role,
        organisation_id: SEED_ORGANISATION.id,
        entity_id: "entity_id" in seedUser ? seedUser.entity_id : null,
        active: true,
      },
      { onConflict: "id" },
    );
    if (userError) throw new Error(`seeding user ${seedUser.email} failed: ${userError.message}`);
  }

  console.log("Seed complete: 1 organisation, 4 users, 3 entities, 2 facilities, 1 cycle.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
