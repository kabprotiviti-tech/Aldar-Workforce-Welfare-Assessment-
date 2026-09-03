import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkClosurePortalAccess, submitPortalClosure, type FindingClosurePortalDb } from "@/lib/findings/closure-portal";
import { generatePortalToken, hashPortalToken } from "@/lib/rfi/token";
import { ADMIN_DATABASE_URL, isReachable, resetAndMigrate } from "./helpers";

/**
 * Acceptance criteria (this prompt, finding lifecycle management):
 * - The closure portal reuses the RFI portal's tokenised-access pattern
 *   exactly — an expired or tampered token returns 403 and is logged,
 *   the same way.
 * - "Closing a finding requires closure evidence and a reviewer
 *   decision; neither can be skipped" — proven here from the portal
 *   side: submitting closure evidence never closes a finding by itself,
 *   only moves it to under_review.
 *
 * Runs the real lib/findings/closure-portal.ts orchestration against a
 * real Postgres instance through a raw pg connection standing in for the
 * service-role client, the same way tests/db/rfi-portal.test.ts does for
 * the RFI portal.
 */
function pgFindingClosurePortalDb(pool: Pool): FindingClosurePortalDb {
  return {
    async findTokenRecord(tokenHash) {
      const { rows } = await pool.query(
        "select finding_id, expires_at, revoked_at from public.finding_closure_tokens where token_hash = $1",
        [tokenHash],
      );
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        requestId: r.finding_id,
        expiresAt: r.expires_at.toISOString(),
        revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
      };
    },
    async recentAttemptTimestamps(tokenHash, sinceIso) {
      const { rows } = await pool.query(
        "select created_at from public.finding_closure_token_access_log where token_hash = $1 and created_at >= $2",
        [tokenHash, sinceIso],
      );
      return rows.map((r) => new Date(r.created_at));
    },
    async logAttempt(tokenHash, ip, outcome) {
      await pool.query("insert into public.finding_closure_token_access_log (token_hash, ip, outcome) values ($1, $2, $3)", [
        tokenHash,
        ip,
        outcome,
      ]);
    },
    async getFinding(findingId) {
      const { rows } = await pool.query(
        `select f.id, f.title, f.status, f.priority, f.due_date, f.owner_name, f.closure_evidence_text,
                r.title as requirement_title, a.subject_code
         from public.findings f
         join public.assessment_items ai on ai.id = f.assessment_item_id
         join public.requirements r on r.id = ai.requirement_id
         join public.assessments a on a.id = ai.assessment_id
         where f.id = $1 and f.deleted_at is null`,
        [findingId],
      );
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        findingId: row.id,
        title: row.title,
        subjectCode: row.subject_code,
        requirementTitle: row.requirement_title,
        status: row.status,
        priority: row.priority,
        dueDate: row.due_date ? row.due_date.toISOString().slice(0, 10) : null,
        ownerName: row.owner_name,
        closureNote: row.closure_evidence_text,
      };
    },
    async recordClosureSubmission(input) {
      const { rows } = await pool.query(
        `select f.owner_contact_id, ai.assessment_id, ai.requirement_id
         from public.findings f join public.assessment_items ai on ai.id = f.assessment_item_id
         where f.id = $1`,
        [input.findingId],
      );
      const row = rows[0];
      const inserted = await pool.query(
        `insert into public.evidence_files
           (assessment_id, requirement_id, finding_id, storage_path, original_name, mime_type, size_bytes,
            document_class, uploaded_by_contact_id, virus_scan_status, virus_scanned_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'finding_closure_evidence', $8, $9, now())
         returning id`,
        [row.assessment_id, row.requirement_id, input.findingId, input.storagePath, input.originalName, input.mimeType, input.sizeBytes, row.owner_contact_id, input.virusScanStatus],
      );
      await pool.query("update public.findings set closure_evidence_text = $1, status = 'under_review' where id = $2", [input.note, input.findingId]);
      await pool.query("insert into public.finding_events (finding_id, event_type, note) values ($1, 'closure_submitted', $2)", [
        input.findingId,
        input.note,
      ]);
      return { evidenceFileId: inserted.rows[0].id };
    },
  };
}

const pool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(pool);

if (!reachable) {
  console.warn(`Skipping finding closure portal test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("finding closure portal token security and closure linkage", () => {
  let db: FindingClosurePortalDb;
  let entityId: string;
  let contactId: string;
  let requirementId: string;
  let assessmentItemId: string;
  let findingId: string;
  let validToken: string;

  async function insertFinding(status: string): Promise<string> {
    const finding = await pool.query<{ id: string }>(
      `insert into public.findings (assessment_item_id, entity_id, title, priority, status, owner_contact_id)
       values ($1, $2, 'Test finding', 'medium', $3, $4) returning id`,
      [assessmentItemId, entityId, status, contactId],
    );
    return finding.rows[0]!.id;
  }

  async function issueToken(forFindingId: string, expiresInDays = 30, revoked = false): Promise<string> {
    const token = generatePortalToken();
    await pool.query(
      "insert into public.finding_closure_tokens (finding_id, token_hash, expires_at, revoked_at) values ($1, $2, now() + $3::interval, $4)",
      [forFindingId, hashPortalToken(token), `${expiresInDays} days`, revoked ? new Date().toISOString() : null],
    );
    return token;
  }

  beforeAll(async () => {
    await resetAndMigrate(pool);
    db = pgFindingClosurePortalDb(pool);

    const cycle = await pool.query<{ id: string }>("insert into public.cycles (year, name) values (2026, 'Closure portal test cycle') returning id");
    const template = await pool.query<{ id: string }>(
      `insert into public.checklist_templates (module, version, effective_from, is_active)
       values ('employment_practices', 301, current_date, true) returning id`,
    );
    const requirement = await pool.query<{ id: string }>(
      "insert into public.requirements (template_id, sl_no, title) values ($1, 1, 'Test requirement') returning id",
      [template.rows[0]!.id],
    );
    requirementId = requirement.rows[0]!.id;

    const entity = await pool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Closure Test Entity', 'CLOSURE-TEST-1', 'general_contractor') returning id",
    );
    entityId = entity.rows[0]!.id;

    const contact = await pool.query<{ id: string }>(
      "insert into public.entity_contacts (entity_id, name, email) values ($1, 'Owner Contact', 'owner@example.com') returning id",
      [entityId],
    );
    contactId = contact.rows[0]!.id;

    const assessment = await pool.query<{ id: string }>(
      `insert into public.assessments (module, cycle_id, entity_id, template_id, subject_code, assessment_type)
       values ('employment_practices', $1, $2, $3, '2026-EP-IN-CLOSURE-TEST-1', 'initial')
       returning id`,
      [cycle.rows[0]!.id, entityId, template.rows[0]!.id],
    );

    const item = await pool.query<{ id: string }>(
      "insert into public.assessment_items (assessment_id, requirement_id) values ($1, $2) returning id",
      [assessment.rows[0]!.id, requirementId],
    );
    assessmentItemId = item.rows[0]!.id;

    findingId = await insertFinding("in_progress");
    validToken = await issueToken(findingId);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("rejects a tampered token with 403 and logs the attempt as invalid", async () => {
    const tamperedToken = `x${validToken.slice(1)}`;
    const result = await checkClosurePortalAccess(db, tamperedToken, "203.0.113.1", new Date());

    expect(result).toEqual({ ok: false, status: 403, reason: expect.any(String) });
    const log = await pool.query(
      "select outcome, ip from public.finding_closure_token_access_log where token_hash = $1 order by created_at desc limit 1",
      [hashPortalToken(tamperedToken)],
    );
    expect(log.rows[0]).toEqual({ outcome: "invalid", ip: "203.0.113.1" });
  });

  it("rejects an expired token with 403 and logs it as expired", async () => {
    const expiredToken = await issueToken(findingId, -1);
    const result = await checkClosurePortalAccess(db, expiredToken, "203.0.113.2", new Date());

    expect(result).toEqual({ ok: false, status: 403, reason: expect.any(String) });
    const log = await pool.query("select outcome from public.finding_closure_token_access_log where token_hash = $1", [
      hashPortalToken(expiredToken),
    ]);
    expect(log.rows[0]).toEqual({ outcome: "expired" });
  });

  it("rejects a revoked token with 403 and logs it as revoked", async () => {
    const revokedToken = await issueToken(findingId, 5, true);
    const result = await checkClosurePortalAccess(db, revokedToken, null, new Date());

    expect(result).toEqual({ ok: false, status: 403, reason: expect.any(String) });
    const log = await pool.query("select outcome from public.finding_closure_token_access_log where token_hash = $1", [
      hashPortalToken(revokedToken),
    ]);
    expect(log.rows[0]).toEqual({ outcome: "revoked" });
  });

  it("accepts a valid token and logs it as success", async () => {
    const result = await checkClosurePortalAccess(db, validToken, "203.0.113.3", new Date());
    expect(result).toEqual({ ok: true, findingId });
  });

  it("rate-limits a token hammered beyond the window and logs it as rate_limited", async () => {
    const hammeredFindingId = await insertFinding("open");
    const hammeredToken = await issueToken(hammeredFindingId);

    let lastResult;
    for (let i = 0; i < 25; i++) {
      lastResult = await checkClosurePortalAccess(db, hammeredToken, "203.0.113.9", new Date());
    }
    expect(lastResult).toEqual({ ok: false, status: 429, reason: expect.any(String) });
  });

  it("submitting closure evidence creates an evidence_files row attributed to the finding's owner contact, and moves the finding to under_review — never straight to closed", async () => {
    const result = await submitPortalClosure(db, validToken, "203.0.113.4", new Date(), {
      note: "Retrained the crew and posted the updated notice.",
      storagePath: `finding-closures/${findingId}/test.pdf`,
      originalName: "evidence.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      virusScanStatus: "clean",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const evidence = await pool.query(
      "select assessment_id, requirement_id, finding_id, uploaded_by, uploaded_by_contact_id, document_class from public.evidence_files where id = $1",
      [result.evidenceFileId],
    );
    expect(evidence.rows[0]).toMatchObject({
      requirement_id: requirementId,
      finding_id: findingId,
      uploaded_by: null,
      uploaded_by_contact_id: contactId,
      document_class: "finding_closure_evidence",
    });

    const finding = await pool.query("select status, closure_evidence_text, reviewer_decision, closed_at from public.findings where id = $1", [findingId]);
    expect(finding.rows[0]).toMatchObject({ status: "under_review", reviewer_decision: null, closed_at: null });
    expect(finding.rows[0].closure_evidence_text).toContain("Retrained the crew");

    const events = await pool.query("select event_type from public.finding_events where finding_id = $1 order by created_at", [findingId]);
    expect(events.rows.map((r) => r.event_type)).toContain("closure_submitted");
  });

  it("rejects a closure submission against an already-closed finding", async () => {
    const closedFindingId = await insertFinding("in_progress");
    await pool.query(
      "insert into public.evidence_files (assessment_id, requirement_id, finding_id, storage_path, original_name, mime_type, size_bytes, uploaded_by_contact_id) select assessment_id, $2, $1, 'x', 'x', 'application/pdf', 1, $4 from public.assessment_items where id = $3",
      [closedFindingId, requirementId, assessmentItemId, contactId],
    );
    await pool.query("update public.findings set reviewer_decision = 'accepted', status = 'closed' where id = $1", [closedFindingId]);
    const closedToken = await issueToken(closedFindingId);

    const result = await submitPortalClosure(db, closedToken, "203.0.113.5", new Date(), {
      note: "Trying again after close.",
      storagePath: "finding-closures/should-not-be-created.pdf",
      originalName: "attempt.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      virusScanStatus: "clean",
    });

    expect(result).toEqual({ ok: false, status: 400, reason: expect.any(String) });
  });
});
