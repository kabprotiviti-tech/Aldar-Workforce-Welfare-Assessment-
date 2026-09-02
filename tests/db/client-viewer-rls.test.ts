import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_DATABASE_URL, asUser, authenticatedDatabaseUrl, isReachable, resetAndMigrate } from "./helpers";

/**
 * Acceptance criterion: "a client_viewer query cannot read another
 * entity's findings." Builds two entities, each with one finding, and two
 * client_viewer users, each scoped to one of those entities via
 * public.users.entity_id — then queries public.findings as each user in
 * turn and checks what comes back.
 *
 * request.jwt.claim.sub stands in for the "sub" claim a real Supabase JWT
 * carries — see tests/db/local-setup.sql's auth.uid() and asUser() in
 * ./helpers. Both users connect through the same `authenticated` Postgres
 * role; only that GUC differs between them, exactly as it would for two
 * real signed-in users hitting the same PostgREST endpoint.
 */
const adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(adminPool);

if (!reachable) {
  // eslint-disable-next-line no-console
  console.warn(`Skipping client_viewer RLS test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("client_viewer RLS is scoped to their own entity", () => {
  let authenticatedPool: Pool;
  let entityAId: string;
  let entityBId: string;
  let findingAId: string;
  let findingBId: string;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    await resetAndMigrate(adminPool);
    authenticatedPool = new Pool({ connectionString: authenticatedDatabaseUrl() });

    const cycle = await adminPool.query<{ id: string }>(
      "insert into public.cycles (year, name) values (2026, 'RLS test cycle') returning id",
    );
    const template = await adminPool.query<{ id: string }>(
      `insert into public.checklist_templates (module, version, effective_from, is_active)
       values ('employment_practices', 1, current_date, true) returning id`,
    );
    const requirement = await adminPool.query<{ id: string }>(
      `insert into public.requirements (template_id, sl_no, title)
       values ($1, 1, 'Test requirement') returning id`,
      [template.rows[0]!.id],
    );

    const entities = await adminPool.query<{ id: string }>(
      `insert into public.entities (name, entity_code, type)
       values ('Entity A', 'RLS-A', 'general_contractor'), ('Entity B', 'RLS-B', 'general_contractor')
       returning id`,
    );
    entityAId = entities.rows[0]!.id;
    entityBId = entities.rows[1]!.id;

    async function makeFinding(entityId: string, subjectCode: string, title: string): Promise<string> {
      const assessment = await adminPool.query<{ id: string }>(
        `insert into public.assessments (module, cycle_id, entity_id, template_id, subject_code, assessment_type)
         values ('employment_practices', $1, $2, $3, $4, 'initial')
         returning id`,
        [cycle.rows[0]!.id, entityId, template.rows[0]!.id, subjectCode],
      );
      const item = await adminPool.query<{ id: string }>(
        "insert into public.assessment_items (assessment_id, requirement_id) values ($1, $2) returning id",
        [assessment.rows[0]!.id, requirement.rows[0]!.id],
      );
      const finding = await adminPool.query<{ id: string }>(
        `insert into public.findings (assessment_item_id, entity_id, title, priority, status)
         values ($1, $2, $3, 'high', 'open') returning id`,
        [item.rows[0]!.id, entityId, title],
      );
      return finding.rows[0]!.id;
    }

    findingAId = await makeFinding(entityAId, "2026-EP-IN-RLS-A", "Finding for entity A");
    findingBId = await makeFinding(entityBId, "2026-EP-IN-RLS-B", "Finding for entity B");

    async function makeClientViewer(entityId: string): Promise<string> {
      const authUser = await adminPool.query<{ id: string }>(
        "insert into auth.users default values returning id",
      );
      const userId = authUser.rows[0]!.id;
      await adminPool.query(
        `insert into public.users (id, full_name, role, entity_id, active)
         values ($1, 'Test client viewer', 'client_viewer', $2, true)`,
        [userId, entityId],
      );
      return userId;
    }

    userAId = await makeClientViewer(entityAId);
    userBId = await makeClientViewer(entityBId);
  });

  afterAll(async () => {
    await authenticatedPool?.end();
    await adminPool.end();
  });

  it("lets a client_viewer see their own entity's findings", async () => {
    const rows = await asUser(authenticatedPool, userAId, (client) =>
      client.query("select id, title from public.findings order by title"),
    );
    expect(rows.rows).toEqual([{ id: findingAId, title: "Finding for entity A" }]);
  });

  it("cannot read another entity's finding by id", async () => {
    const rows = await asUser(authenticatedPool, userAId, (client) =>
      client.query("select id from public.findings where id = $1", [findingBId]),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it("a second client_viewer, scoped to entity B, sees only entity B's finding", async () => {
    const rows = await asUser(authenticatedPool, userBId, (client) =>
      client.query("select id, title from public.findings order by title"),
    );
    expect(rows.rows).toEqual([{ id: findingBId, title: "Finding for entity B" }]);
  });

  it("staff (admin) sees both findings regardless of entity", async () => {
    const admin = await adminPool.query<{ id: string }>(
      "insert into auth.users default values returning id",
    );
    await adminPool.query(
      "insert into public.users (id, full_name, role, active) values ($1, 'Test admin', 'admin', true)",
      [admin.rows[0]!.id],
    );

    const rows = await asUser(authenticatedPool, admin.rows[0]!.id, (client) =>
      client.query("select id from public.findings order by title"),
    );
    expect(rows.rows.map((r) => r.id).sort()).toEqual([findingAId, findingBId].sort());
  });
});
