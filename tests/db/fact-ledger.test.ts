import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bulkAcceptHighConfidence, resolveFact, type FactLedgerDb } from "@/lib/facts/resolve";
import { ledgerFactFromRow, type ExtractedFactRowLike } from "@/lib/facts/ledger";
import { ADMIN_DATABASE_URL, asUser, isReachable, resetAndMigrate } from "./helpers";

/**
 * Acceptance criteria (this prompt):
 * - "No downstream query reads extracted_facts where status = 'proposed'.
 *   Enforce this with a database view fact_ledger_confirmed and make it
 *   the only read path, proven by a test."
 * - "Every accept/edit/reject writes to audit_log."
 *
 * Runs the real lib/facts/resolve.ts orchestration against real Postgres
 * through the real resolve_extracted_fact function
 * (0021_fact_ledger.sql) — not a mock — as a real signed-in assessor, so
 * the function's own is_staff() check and auth.uid() attribution are
 * exercised too.
 */
const FACT_COLUMNS =
  "id, evidence_file_id, fact_key, value_text, value_number, value_date, value_boolean, value_json, unit, page_ref, verbatim_quote, confidence, status, reason, rejection_reason, resolved_value_json, bbox, resolved_at";

/**
 * The port, implemented over a connection whose request.jwt.claim.sub is
 * set to a real assessor — the closest local stand-in for the
 * session-scoped Supabase client the server actions use.
 */
function pgFactLedgerDb(pool: Pool, userId: string): FactLedgerDb {
  return {
    async getFacts(factIds) {
      if (factIds.length === 0) return [];
      const rows = await asUser(pool, userId, (client) =>
        client.query(`select ${FACT_COLUMNS} from public.extracted_facts where id = any($1::uuid[])`, [factIds]),
      );
      return rows.rows.map((row) => ledgerFactFromRow(row as ExtractedFactRowLike));
    },
    async resolveFact(input) {
      await asUser(pool, userId, (client) =>
        client.query("select public.resolve_extracted_fact($1, $2, $3, $4)", [
          input.factId,
          input.status,
          input.resolvedValue ? JSON.stringify(input.resolvedValue) : null,
          input.rejectionReason,
        ]),
      );
    },
  };
}

const pool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(pool);

if (!reachable) {
  console.warn(`Skipping fact ledger test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("fact ledger: the confirmed view and the audit trail", () => {
  let assessorId: string;
  let viewerId: string;
  let evidenceFileId: string;
  let extractionId: string;
  let db: FactLedgerDb;

  async function insertFact(overrides: {
    factKey: string;
    confidence?: string;
    valueText?: string | null;
    valueNumber?: number | null;
    valueDate?: string | null;
    valueBoolean?: boolean | null;
    valueJson?: unknown;
    status?: string;
  }): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `insert into public.extracted_facts
         (extraction_id, evidence_file_id, fact_key, value_text, value_number, value_date, value_boolean, value_json,
          unit, page_ref, verbatim_quote, confidence, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, null, 'page 1', 'quoted from the document', $9, $10)
       returning id`,
      [
        extractionId,
        evidenceFileId,
        overrides.factKey,
        overrides.valueText ?? null,
        overrides.valueNumber ?? null,
        overrides.valueDate ?? null,
        overrides.valueBoolean ?? null,
        overrides.valueJson === undefined ? null : JSON.stringify(overrides.valueJson),
        overrides.confidence ?? "high",
        overrides.status ?? "proposed",
      ],
    );
    return result.rows[0]!.id;
  }

  beforeAll(async () => {
    await resetAndMigrate(pool);

    const assessor = await pool.query<{ id: string }>("insert into auth.users default values returning id");
    assessorId = assessor.rows[0]!.id;
    await pool.query("insert into public.users (id, full_name, role, active) values ($1, 'Test assessor', 'assessor', true)", [assessorId]);

    const viewer = await pool.query<{ id: string }>("insert into auth.users default values returning id");
    viewerId = viewer.rows[0]!.id;
    await pool.query("insert into public.users (id, full_name, role, active) values ($1, 'Test client viewer', 'client_viewer', true)", [viewerId]);

    const cycle = await pool.query<{ id: string }>("insert into public.cycles (year, name) values (2026, 'Ledger test cycle') returning id");
    const template = await pool.query<{ id: string }>(
      `insert into public.checklist_templates (module, version, effective_from, is_active)
       values ('employment_practices', 401, current_date, true) returning id`,
    );
    const entity = await pool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Ledger Test Entity', 'LEDGER-1', 'general_contractor') returning id",
    );
    const assessment = await pool.query<{ id: string }>(
      `insert into public.assessments (module, cycle_id, entity_id, template_id, subject_code, assessment_type)
       values ('employment_practices', $1, $2, $3, '2026-EP-IN-LEDGER-1', 'initial') returning id`,
      [cycle.rows[0]!.id, entity.rows[0]!.id, template.rows[0]!.id],
    );
    const evidenceFile = await pool.query<{ id: string }>(
      `insert into public.evidence_files (assessment_id, storage_path, original_name, mime_type, size_bytes, document_class, uploaded_by)
       values ($1, 'evidence/ledger/wps.pdf', 'wps.pdf', 'application/pdf', 2048, 'wps_report', $2) returning id`,
      [assessment.rows[0]!.id, assessorId],
    );
    evidenceFileId = evidenceFile.rows[0]!.id;

    const extraction = await pool.query<{ id: string }>(
      `insert into public.extractions (evidence_file_id, model, prompt_version, input_tokens, output_tokens, cost_usd)
       values ($1, 'claude-sonnet-4-6', 'wps_report.v1', 1000, 100, 0.0045) returning id`,
      [evidenceFileId],
    );
    extractionId = extraction.rows[0]!.id;

    db = pgFactLedgerDb(pool, assessorId);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("hides a proposed fact from fact_ledger_confirmed entirely", async () => {
    const factId = await insertFact({ factKey: "wps_batch_status", valueText: "Approved" });

    const raw = await pool.query("select status from public.extracted_facts where id = $1", [factId]);
    expect(raw.rows[0]!.status).toBe("proposed");

    const view = await pool.query("select id from public.fact_ledger_confirmed where id = $1", [factId]);
    expect(view.rows).toHaveLength(0);
  });

  it("shows a fact only once a person accepts it, and never after a rejection", async () => {
    const accepted = await insertFact({ factKey: "wps_record_count", valueNumber: 42 });
    const rejected = await insertFact({ factKey: "wps_transfer_date", valueDate: "2026-05-01" });

    expect(await resolveFact(db, accepted, { kind: "accept" })).toEqual({ ok: true });
    expect(await resolveFact(db, rejected, { kind: "reject", reason: "Read from the wrong column" })).toEqual({ ok: true });

    const view = await pool.query("select id, fact_key, confirmed_value, status from public.fact_ledger_confirmed where id = any($1::uuid[])", [
      [accepted, rejected],
    ]);
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]).toMatchObject({ id: accepted, fact_key: "wps_record_count", confirmed_value: 42, status: "accepted" });
  });

  it("serves an edited fact's human value as confirmed_value, not the model's superseded proposal", async () => {
    const factId = await insertFact({ factKey: "wps_record_count", valueNumber: 42 });

    expect(await resolveFact(db, factId, { kind: "edit", value: 43 })).toEqual({ ok: true });

    const view = await pool.query("select confirmed_value, status from public.fact_ledger_confirmed where id = $1", [factId]);
    expect(view.rows[0]).toEqual({ confirmed_value: 43, status: "edited" });

    // The model's original proposal is still on the row as provenance for
    // the verbatim quote — it just isn't what anything downstream reads.
    const raw = await pool.query("select value_number, resolved_value_json from public.extracted_facts where id = $1", [factId]);
    expect(Number(raw.rows[0]!.value_number)).toBe(42);
    expect(raw.rows[0]!.resolved_value_json).toEqual({ value: 43 });
  });

  it("exposes no raw value_* column through the view, so a superseded proposal can't be read by mistake", async () => {
    const columns = await pool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'fact_ledger_confirmed'",
    );
    const names = columns.rows.map((row) => row.column_name);

    expect(names).toContain("confirmed_value");
    expect(names.filter((name) => name.startsWith("value_"))).toEqual([]);
    expect(names).not.toContain("resolved_value_json");
    expect(names).not.toContain("rejection_reason");
  });

  it("carries a list value and a boolean through the view unchanged", async () => {
    const list = await insertFact({ factKey: "payroll_deduction_types", valueJson: ["Accommodation", "Transport"] });
    const flag = await insertFact({ factKey: "agency_employer_pays_clause_present", valueBoolean: true });

    await resolveFact(db, list, { kind: "accept" });
    await resolveFact(db, flag, { kind: "accept" });

    const view = await pool.query("select id, confirmed_value from public.fact_ledger_confirmed where id = any($1::uuid[])", [[list, flag]]);
    const byId = new Map(view.rows.map((row) => [row.id, row.confirmed_value]));
    expect(byId.get(list)).toEqual(["Accommodation", "Transport"]);
    expect(byId.get(flag)).toBe(true);
  });

  it("writes exactly one audit_log row per accept, edit and reject, attributed to the assessor", async () => {
    const accepted = await insertFact({ factKey: "wps_batch_status", valueText: "Approved" });
    const edited = await insertFact({ factKey: "wps_record_count", valueNumber: 10 });
    const rejected = await insertFact({ factKey: "wps_transfer_date", valueDate: "2026-01-01" });

    await resolveFact(db, accepted, { kind: "accept" });
    await resolveFact(db, edited, { kind: "edit", value: 11 });
    await resolveFact(db, rejected, { kind: "reject", reason: "Wrong document" });

    const log = await pool.query(
      `select entity_id, action, actor_id, entity_type, before, after
       from public.audit_log where entity_id = any($1::text[]) order by created_at`,
      [[accepted, edited, rejected]],
    );

    expect(log.rows).toHaveLength(3);
    expect(log.rows.map((row) => row.action)).toEqual(["fact.accept", "fact.edit", "fact.reject"]);
    expect(log.rows.every((row) => row.actor_id === assessorId)).toBe(true);
    expect(log.rows.every((row) => row.entity_type === "extracted_fact")).toBe(true);

    // before/after are the row's real state either side of the change,
    // read from the row itself rather than supplied by the caller.
    const editRow = log.rows[1]!;
    expect(editRow.before.status).toBe("proposed");
    expect(editRow.after.status).toBe("edited");
    expect(editRow.after.resolved_value_json).toEqual({ value: 11 });

    const rejectRow = log.rows[2]!;
    expect(rejectRow.after.rejection_reason).toBe("Wrong document");
  });

  it("records an individual audit row per fact for a bulk accept, not one row for the batch", async () => {
    const ids = await Promise.all([
      insertFact({ factKey: "wps_record_count", valueNumber: 1, confidence: "high" }),
      insertFact({ factKey: "wps_batch_status", valueText: "Approved", confidence: "high" }),
      insertFact({ factKey: "wps_transfer_date", valueDate: "2026-02-01", confidence: "high" }),
    ]);

    const result = await bulkAcceptHighConfidence(db, ids);
    expect(result).toEqual({ accepted: 3, skipped: [] });

    const log = await pool.query("select entity_id, action from public.audit_log where entity_id = any($1::text[])", [ids]);
    expect(log.rows).toHaveLength(3);
    expect(new Set(log.rows.map((row) => row.entity_id))).toEqual(new Set(ids));
    expect(log.rows.every((row) => row.action === "fact.accept")).toBe(true);

    const view = await pool.query("select id from public.fact_ledger_confirmed where id = any($1::uuid[])", [ids]);
    expect(view.rows).toHaveLength(3);
  });

  it("refuses to bulk accept medium and low confidence facts, leaving them out of the view and the audit log", async () => {
    const medium = await insertFact({ factKey: "wps_batch_status", valueText: "Pending", confidence: "medium" });
    const low = await insertFact({ factKey: "wps_record_count", valueNumber: 7, confidence: "low" });

    const result = await bulkAcceptHighConfidence(db, [medium, low]);
    expect(result).toEqual({ accepted: 0, skipped: [medium, low] });

    const view = await pool.query("select id from public.fact_ledger_confirmed where id = any($1::uuid[])", [[medium, low]]);
    expect(view.rows).toHaveLength(0);

    const log = await pool.query("select id from public.audit_log where entity_id = any($1::text[])", [[medium, low]]);
    expect(log.rows).toHaveLength(0);
  });

  it("refuses a rejection with no reason at the database level too, not only in the orchestration", async () => {
    const factId = await insertFact({ factKey: "wps_batch_status", valueText: "Approved" });

    await expect(
      asUser(pool, assessorId, (client) => client.query("select public.resolve_extracted_fact($1, 'rejected', null, '   ')", [factId])),
    ).rejects.toThrow(/rejection needs a reason/);

    const raw = await pool.query("select status from public.extracted_facts where id = $1", [factId]);
    expect(raw.rows[0]!.status).toBe("proposed");
  });

  it("refuses a non-staff caller, so a client_viewer can't confirm a fact", async () => {
    const factId = await insertFact({ factKey: "wps_batch_status", valueText: "Approved" });

    await expect(
      asUser(pool, viewerId, (client) => client.query("select public.resolve_extracted_fact($1, 'accepted', null, null)", [factId])),
    ).rejects.toThrow(/only staff may resolve/);

    const view = await pool.query("select id from public.fact_ledger_confirmed where id = $1", [factId]);
    expect(view.rows).toHaveLength(0);

    const log = await pool.query("select id from public.audit_log where entity_id = $1", [factId]);
    expect(log.rows).toHaveLength(0);
  });
});
