import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkPortalAccess, submitPortalUpload, type RfiPortalDb } from "@/lib/rfi/portal";
import { generatePortalToken, hashPortalToken } from "@/lib/rfi/token";
import { ADMIN_DATABASE_URL, isReachable, resetAndMigrate } from "./helpers";

/**
 * Acceptance criteria (this prompt):
 * - "An expired or tampered token returns 403 and is logged."
 * - "Uploading against a checklist line creates an evidence_files row
 *   linked to the assessment and the requirement, with the uploader
 *   recorded as the entity contact."
 *
 * Runs the real lib/rfi/portal.ts orchestration (checkPortalAccess,
 * submitPortalUpload) against a real Postgres instance through a
 * service-role-equivalent connection (the admin pool bypasses RLS, the
 * same way lib/supabase/admin.ts's service-role client does in
 * production — the portal has no Supabase session to be subject to RLS
 * at all) — not a mock.
 */
function pgRfiPortalDb(pool: Pool): RfiPortalDb {
  return {
    async findTokenRecord(tokenHash) {
      const { rows } = await pool.query(
        "select rfi_request_id, expires_at, revoked_at from public.rfi_tokens where token_hash = $1",
        [tokenHash],
      );
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        requestId: r.rfi_request_id,
        expiresAt: r.expires_at.toISOString(),
        revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
      };
    },
    async recentAttemptTimestamps(tokenHash, sinceIso) {
      const { rows } = await pool.query(
        "select created_at from public.rfi_token_access_log where token_hash = $1 and created_at >= $2",
        [tokenHash, sinceIso],
      );
      return rows.map((r) => new Date(r.created_at));
    },
    async logAttempt(tokenHash, ip, outcome) {
      await pool.query("insert into public.rfi_token_access_log (token_hash, ip, outcome) values ($1, $2, $3)", [
        tokenHash,
        ip,
        outcome,
      ]);
    },
    async getChecklist(requestId) {
      const { rows } = await pool.query(
        `select r.id, r.assessment_id, r.contact_id, r.due_date, r.status, a.subject_code
         from public.rfi_requests r join public.assessments a on a.id = r.assessment_id
         where r.id = $1 and r.deleted_at is null`,
        [requestId],
      );
      if (rows.length === 0) return null;
      const req = rows[0];
      const items = await pool.query(
        "select id, name, status, requirement_id from public.rfi_checklist_items where rfi_request_id = $1 order by name",
        [requestId],
      );
      return {
        requestId: req.id,
        assessmentId: req.assessment_id,
        subjectCode: req.subject_code,
        contactId: req.contact_id,
        dueDate: req.due_date.toISOString().slice(0, 10),
        status: req.status,
        items: items.rows.map((i) => ({ id: i.id, name: i.name, status: i.status, requirementId: i.requirement_id })),
      };
    },
    async getChecklistItemRequestId(checklistItemId) {
      const { rows } = await pool.query("select rfi_request_id from public.rfi_checklist_items where id = $1", [
        checklistItemId,
      ]);
      return rows[0]?.rfi_request_id ?? null;
    },
    async recordUpload(input) {
      const { rows } = await pool.query(
        `select i.requirement_id, r.id as request_id, r.assessment_id, r.contact_id
         from public.rfi_checklist_items i join public.rfi_requests r on r.id = i.rfi_request_id
         where i.id = $1`,
        [input.checklistItemId],
      );
      const row = rows[0];
      const inserted = await pool.query(
        `insert into public.evidence_files
           (assessment_id, requirement_id, rfi_checklist_item_id, storage_path, original_name, mime_type, size_bytes,
            document_class, uploaded_by_contact_id, virus_scan_status, virus_scanned_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'rfi_upload', $8, $9, now())
         returning id`,
        [
          row.assessment_id,
          row.requirement_id,
          input.checklistItemId,
          input.storagePath,
          input.originalName,
          input.mimeType,
          input.sizeBytes,
          row.contact_id,
          input.virusScanStatus,
        ],
      );
      await pool.query("update public.rfi_checklist_items set status = 'received' where id = $1", [input.checklistItemId]);
      const outstanding = await pool.query(
        "select count(*) from public.rfi_checklist_items where rfi_request_id = $1 and status = 'outstanding'",
        [row.request_id],
      );
      if (Number(outstanding.rows[0].count) === 0) {
        await pool.query("update public.rfi_requests set status = 'completed' where id = $1", [row.request_id]);
      }
      return { evidenceFileId: inserted.rows[0].id };
    },
  };
}

const pool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(pool);

if (!reachable) {

  console.warn(`Skipping RFI portal test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("RFI portal token security and upload linkage", () => {
  let db: RfiPortalDb;
  let entityId: string;
  let contactId: string;
  let assessmentId: string;
  let requirementId: string;
  let requestId: string;
  let checklistItemId: string;
  let validToken: string;

  beforeAll(async () => {
    await resetAndMigrate(pool);
    db = pgRfiPortalDb(pool);

    const cycle = await pool.query<{ id: string }>("insert into public.cycles (year, name) values (2026, 'RFI test cycle') returning id");
    const template = await pool.query<{ id: string }>(
      `insert into public.checklist_templates (module, version, effective_from, is_active)
       values ('employment_practices', 201, current_date, true) returning id`,
    );
    const requirement = await pool.query<{ id: string }>(
      "insert into public.requirements (template_id, sl_no, title) values ($1, 1, 'Test requirement') returning id",
      [template.rows[0]!.id],
    );
    requirementId = requirement.rows[0]!.id;

    const entity = await pool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('RFI Test Entity', 'RFI-TEST-1', 'general_contractor') returning id",
    );
    entityId = entity.rows[0]!.id;

    const contact = await pool.query<{ id: string }>(
      "insert into public.entity_contacts (entity_id, name, email) values ($1, 'Test Contact', 'contact@example.com') returning id",
      [entityId],
    );
    contactId = contact.rows[0]!.id;

    const assessment = await pool.query<{ id: string }>(
      `insert into public.assessments (module, cycle_id, entity_id, template_id, subject_code, assessment_type)
       values ('employment_practices', $1, $2, $3, '2026-EP-IN-RFI-TEST-1', 'initial')
       returning id`,
      [cycle.rows[0]!.id, entityId, template.rows[0]!.id],
    );
    assessmentId = assessment.rows[0]!.id;

    const request = await pool.query<{ id: string }>(
      "insert into public.rfi_requests (assessment_id, contact_id) values ($1, $2) returning id",
      [assessmentId, contactId],
    );
    requestId = request.rows[0]!.id;

    const item = await pool.query<{ id: string }>(
      "insert into public.rfi_checklist_items (rfi_request_id, requirement_id, name) values ($1, $2, 'Payroll register') returning id",
      [requestId, requirementId],
    );
    checklistItemId = item.rows[0]!.id;

    validToken = generatePortalToken();
    await pool.query(
      "insert into public.rfi_tokens (rfi_request_id, token_hash, expires_at) values ($1, $2, now() + interval '21 days')",
      [requestId, hashPortalToken(validToken)],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("rejects a tampered token with 403 and logs the attempt as invalid", async () => {
    const tamperedToken = `x${validToken.slice(1)}`;
    const result = await checkPortalAccess(db, tamperedToken, "203.0.113.1", new Date());

    expect(result).toEqual({ ok: false, status: 403, reason: expect.any(String) });

    const log = await pool.query(
      "select outcome, ip from public.rfi_token_access_log where token_hash = $1 order by created_at desc limit 1",
      [hashPortalToken(tamperedToken)],
    );
    expect(log.rows[0]).toEqual({ outcome: "invalid", ip: "203.0.113.1" });
  });

  it("rejects an expired token with 403 and logs it as expired", async () => {
    const expiredToken = generatePortalToken();
    const expiredRequest = await pool.query<{ id: string }>(
      "insert into public.rfi_requests (assessment_id, contact_id) values ($1, $2) returning id",
      [assessmentId, contactId],
    );
    await pool.query(
      "insert into public.rfi_tokens (rfi_request_id, token_hash, expires_at) values ($1, $2, now() - interval '1 day')",
      [expiredRequest.rows[0]!.id, hashPortalToken(expiredToken)],
    );

    const result = await checkPortalAccess(db, expiredToken, "203.0.113.2", new Date());
    expect(result).toEqual({ ok: false, status: 403, reason: expect.any(String) });

    const log = await pool.query("select outcome from public.rfi_token_access_log where token_hash = $1", [
      hashPortalToken(expiredToken),
    ]);
    expect(log.rows[0]).toEqual({ outcome: "expired" });
  });

  it("rejects a revoked token with 403 and logs it as revoked", async () => {
    const revokedToken = generatePortalToken();
    const revokedRequest = await pool.query<{ id: string }>(
      "insert into public.rfi_requests (assessment_id, contact_id) values ($1, $2) returning id",
      [assessmentId, contactId],
    );
    await pool.query(
      "insert into public.rfi_tokens (rfi_request_id, token_hash, expires_at, revoked_at) values ($1, $2, now() + interval '5 days', now())",
      [revokedRequest.rows[0]!.id, hashPortalToken(revokedToken)],
    );

    const result = await checkPortalAccess(db, revokedToken, null, new Date());
    expect(result).toEqual({ ok: false, status: 403, reason: expect.any(String) });

    const log = await pool.query("select outcome from public.rfi_token_access_log where token_hash = $1", [
      hashPortalToken(revokedToken),
    ]);
    expect(log.rows[0]).toEqual({ outcome: "revoked" });
  });

  it("accepts a valid token and logs it as success", async () => {
    const result = await checkPortalAccess(db, validToken, "203.0.113.3", new Date());
    expect(result).toEqual({ ok: true, requestId });

    const log = await pool.query(
      "select outcome from public.rfi_token_access_log where token_hash = $1 order by created_at desc limit 1",
      [hashPortalToken(validToken)],
    );
    expect(log.rows[0]).toEqual({ outcome: "success" });
  });

  it("rate-limits a token hammered beyond the window and logs it as rate_limited", async () => {
    const hammeredToken = generatePortalToken();
    const hammeredRequest = await pool.query<{ id: string }>(
      "insert into public.rfi_requests (assessment_id, contact_id) values ($1, $2) returning id",
      [assessmentId, contactId],
    );
    await pool.query(
      "insert into public.rfi_tokens (rfi_request_id, token_hash, expires_at) values ($1, $2, now() + interval '21 days')",
      [hammeredRequest.rows[0]!.id, hashPortalToken(hammeredToken)],
    );

    let lastResult;
    for (let i = 0; i < 25; i++) {
      lastResult = await checkPortalAccess(db, hammeredToken, "203.0.113.9", new Date());
    }
    expect(lastResult).toEqual({ ok: false, status: 429, reason: expect.any(String) });

    const log = await pool.query(
      "select outcome from public.rfi_token_access_log where token_hash = $1 order by created_at desc limit 1",
      [hashPortalToken(hammeredToken)],
    );
    expect(log.rows[0]).toEqual({ outcome: "rate_limited" });
  });

  it("uploading against a checklist line creates an evidence_files row linked to the assessment and the requirement, uploader as the entity contact", async () => {
    const result = await submitPortalUpload(db, validToken, "203.0.113.4", new Date(), {
      checklistItemId,
      storagePath: `rfi-uploads/${checklistItemId}/test.pdf`,
      originalName: "payroll.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      virusScanStatus: "clean",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const row = await pool.query(
      `select assessment_id, requirement_id, rfi_checklist_item_id, uploaded_by, uploaded_by_contact_id,
              document_class, virus_scan_status
       from public.evidence_files where id = $1`,
      [result.evidenceFileId],
    );
    expect(row.rows[0]).toEqual({
      assessment_id: assessmentId,
      requirement_id: requirementId,
      rfi_checklist_item_id: checklistItemId,
      uploaded_by: null,
      uploaded_by_contact_id: contactId,
      document_class: "rfi_upload",
      virus_scan_status: "clean",
    });

    const item = await pool.query("select status from public.rfi_checklist_items where id = $1", [checklistItemId]);
    expect(item.rows[0].status).toBe("received");

    const request = await pool.query("select status from public.rfi_requests where id = $1", [requestId]);
    expect(request.rows[0].status).toBe("completed"); // it was the only checklist item.
  });

  it("rejects an upload against a checklist line that doesn't belong to the presented token", async () => {
    const otherRequest = await pool.query<{ id: string }>(
      "insert into public.rfi_requests (assessment_id, contact_id) values ($1, $2) returning id",
      [assessmentId, contactId],
    );
    const otherItem = await pool.query<{ id: string }>(
      "insert into public.rfi_checklist_items (rfi_request_id, requirement_id, name) values ($1, $2, 'Other doc') returning id",
      [otherRequest.rows[0]!.id, requirementId],
    );

    const result = await submitPortalUpload(db, validToken, "203.0.113.5", new Date(), {
      checklistItemId: otherItem.rows[0]!.id,
      storagePath: "rfi-uploads/should-not-be-created.pdf",
      originalName: "attempt.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      virusScanStatus: "clean",
    });

    expect(result).toEqual({ ok: false, status: 403, reason: expect.any(String) });

    const evidence = await pool.query("select count(*) from public.evidence_files where original_name = 'attempt.pdf'");
    expect(Number(evidence.rows[0].count)).toBe(0);
  });
});
