import { performance } from "node:perf_hooks";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_DATABASE_URL, asUser, authenticatedDatabaseUrl, isReachable, resetAndMigrate } from "./helpers";

/**
 * lib/tracker/export-supabase.ts reads through a real @supabase/supabase-js
 * client (PostgREST), which this local Postgres stand-in has no
 * equivalent of — the same limitation already accepted for
 * lib/reports/generate-supabase.ts and lib/qa/checklist-supabase.ts (see
 * docs/decisions.md). pgTrackerRows below mirrors that adapter's exact
 * query shape and column mapping as raw SQL, run through RLS as a real
 * assessor, so this test proves what a unit test against a mock never
 * could: that the real is_staff() policies, the real
 * assessment_items_status_requires_assessor trigger
 * (0024_assessment_decision.sql) that stamps decided_at, and the joins
 * export-supabase.ts's reasoning depends on actually produce the values
 * that reasoning assumes.
 */
interface PgTrackerRequirement {
  slNo: number;
  rating: string | null;
  decidedAt: Date | null;
}

interface PgTrackerRow {
  assessmentId: string;
  subjectCode: string;
  entityName: string;
  facilityName: string | null;
  rfiIssueDate: Date | null;
  completedDesktopAssessmentDate: Date | null;
  officeVisitDate: string | null;
  completedVisitDate: string | null;
  reportCompletionDate: Date | null;
  reportQaCompletionDate: Date | null;
  reportApprovalDate: Date | null;
  reportIssuanceDate: Date | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  requirements: PgTrackerRequirement[];
}

async function pgTrackerRows(client: PoolClient, cycleId: string): Promise<PgTrackerRow[]> {
  const { rows: assessmentRows } = await client.query(
    `select a.id, a.subject_code, a.entity_id,
            to_char(a.confirmed_visit_date, 'YYYY-MM-DD') as office_visit_date,
            to_char(a.actual_visit_date, 'YYYY-MM-DD') as completed_visit_date,
            a.qa_completed_at, a.approved_at, a.issued_at,
            e.name as entity_name, f.name as facility_name
     from public.assessments a
     join public.entities e on e.id = a.entity_id
     left join public.facilities f on f.id = a.facility_id
     where a.cycle_id = $1 and a.deleted_at is null
     order by a.subject_code`,
    [cycleId],
  );
  const assessmentIds = assessmentRows.map((r) => r.id as string);
  if (assessmentIds.length === 0) return [];

  // Sequential, not Promise.all: a single pg connection can't run
  // concurrent queries (unlike the real adapter's SupabaseClient, which
  // issues separate HTTP requests and can).
  const itemsResult = await client.query(
    `select ai.assessment_id, ai.compliance_status, ai.decided_at, r.sl_no
     from public.assessment_items ai
     join public.requirements r on r.id = ai.requirement_id
     where ai.assessment_id = any($1)`,
    [assessmentIds],
  );
  const rfiResult = await client.query(
    `select assessment_id, status, issued_at from public.rfi_requests where assessment_id = any($1) order by issued_at`,
    [assessmentIds],
  );
  const contactsResult = await client.query(
    `select ec.entity_id, ec.name, ec.email, ec.phone
     from public.entity_contacts ec
     where ec.entity_id = any($1) and ec.is_primary = true and ec.deleted_at is null`,
    [assessmentRows.map((r) => r.entity_id as string)],
  );

  const completedRfiAssessmentIds = Array.from(
    new Set(rfiResult.rows.filter((r) => r.status === "completed").map((r) => r.assessment_id as string)),
  );
  const lastPortalUploadByAssessmentId = new Map<string, Date>();
  if (completedRfiAssessmentIds.length > 0) {
    const { rows: evidenceRows } = await client.query(
      `select assessment_id, uploaded_at from public.evidence_files
       where assessment_id = any($1) and document_class = 'rfi_upload'
       order by uploaded_at desc`,
      [completedRfiAssessmentIds],
    );
    for (const row of evidenceRows) {
      const assessmentId = row.assessment_id as string;
      if (!lastPortalUploadByAssessmentId.has(assessmentId)) {
        lastPortalUploadByAssessmentId.set(assessmentId, row.uploaded_at as Date);
      }
    }
  }

  const earliestRfiIssuedAtByAssessmentId = new Map<string, Date>();
  for (const row of rfiResult.rows) {
    const assessmentId = row.assessment_id as string;
    if (!earliestRfiIssuedAtByAssessmentId.has(assessmentId)) {
      earliestRfiIssuedAtByAssessmentId.set(assessmentId, row.issued_at as Date);
    }
  }

  const contactByEntityId = new Map<string, { name: string; email: string | null; phone: string | null }>();
  for (const row of contactsResult.rows) {
    contactByEntityId.set(row.entity_id as string, { name: row.name as string, email: row.email as string | null, phone: row.phone as string | null });
  }

  const requirementsByAssessmentId = new Map<string, PgTrackerRequirement[]>();
  const lastDecidedAtByAssessmentId = new Map<string, Date>();
  for (const row of itemsResult.rows) {
    const assessmentId = row.assessment_id as string;
    const list = requirementsByAssessmentId.get(assessmentId) ?? [];
    list.push({ slNo: row.sl_no as number, rating: row.compliance_status as string | null, decidedAt: (row.decided_at as Date | null) ?? null });
    requirementsByAssessmentId.set(assessmentId, list);

    const decidedAt = row.decided_at as Date | null;
    if (decidedAt) {
      const current = lastDecidedAtByAssessmentId.get(assessmentId);
      if (!current || decidedAt > current) lastDecidedAtByAssessmentId.set(assessmentId, decidedAt);
    }
  }

  return assessmentRows.map((row) => {
    const id = row.id as string;
    const entityId = row.entity_id as string;
    const contact = contactByEntityId.get(entityId) ?? null;
    const rfiIssueDate = earliestRfiIssuedAtByAssessmentId.get(id) ?? null;
    return {
      assessmentId: id,
      subjectCode: row.subject_code as string,
      entityName: row.entity_name as string,
      facilityName: (row.facility_name as string | null) ?? null,
      rfiIssueDate,
      completedDesktopAssessmentDate: lastPortalUploadByAssessmentId.get(id) ?? null,
      officeVisitDate: (row.office_visit_date as string | null) ?? null,
      completedVisitDate: (row.completed_visit_date as string | null) ?? null,
      reportCompletionDate: lastDecidedAtByAssessmentId.get(id) ?? null,
      reportQaCompletionDate: (row.qa_completed_at as Date | null) ?? null,
      reportApprovalDate: (row.approved_at as Date | null) ?? null,
      reportIssuanceDate: (row.issued_at as Date | null) ?? null,
      contactName: contact?.name ?? null,
      contactEmail: contact?.email ?? null,
      contactPhone: contact?.phone ?? null,
      requirements: requirementsByAssessmentId.get(id) ?? [],
    };
  });
}

const adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(adminPool);

if (!reachable) {
  console.warn(`Skipping tracker DB test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("the Excel tracker's underlying queries against a real database", () => {
  let authenticatedPool: Pool;
  let assessorId: string;

  beforeAll(async () => {
    await resetAndMigrate(adminPool);
    authenticatedPool = new Pool({ connectionString: authenticatedDatabaseUrl() });

    const assessor = await adminPool.query<{ id: string }>("insert into auth.users default values returning id");
    assessorId = assessor.rows[0]!.id;
    await adminPool.query("insert into public.users (id, full_name, role, active) values ($1, 'Test assessor', 'assessor', true)", [assessorId]);
  });

  afterAll(async () => {
    await authenticatedPool?.end();
    await adminPool.end();
  });

  it("maps every RFP date column to the right real, stored event", async () => {
    const cycle = await adminPool.query<{ id: string }>("insert into public.cycles (year, name) values (2026, 'Tracker correctness cycle') returning id");
    const cycleId = cycle.rows[0]!.id;

    const entity = await adminPool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Tracker Test Co', 'TRK-1', 'general_contractor') returning id",
    );
    const entityId = entity.rows[0]!.id;

    await adminPool.query(
      "insert into public.entity_contacts (entity_id, name, email, phone, is_primary) values ($1, 'Primary Contact', 'primary@example.com', '+971500000000', true), ($1, 'Secondary Contact', 'secondary@example.com', null, false)",
      [entityId],
    );

    const template = await adminPool.query<{ id: string }>(
      "select id from public.checklist_templates where module = 'employment_practices' and is_active = true limit 1",
    );
    const templateId = template.rows[0]!.id;
    const requirements = await adminPool.query<{ id: string; sl_no: number }>(
      "select id, sl_no from public.requirements where template_id = $1 and sl_no in (1, 2) order by sl_no",
      [templateId],
    );
    const [requirement1, requirement2] = requirements.rows;

    const qaCompletedAt = new Date("2026-02-10T09:00:00Z");
    const approvedAt = new Date("2026-02-12T09:00:00Z");
    const issuedAt = new Date("2026-02-12T09:00:00Z");
    const assessment = await adminPool.query<{ id: string }>(
      `insert into public.assessments
         (module, cycle_id, entity_id, template_id, subject_code, assessment_type,
          confirmed_visit_date, actual_visit_date, qa_completed_at, approved_at, issued_at)
       values ('employment_practices', $1, $2, $3, '2026-EP-IN-TRK-1', 'initial',
               '2026-01-15', '2026-01-16', $4, $5, $6)
       returning id`,
      [cycleId, entityId, templateId, qaCompletedAt, approvedAt, issuedAt],
    );
    const assessmentId = assessment.rows[0]!.id;

    // Two RFIs — the earlier one is what "RFI issue date" reads, even
    // though a later one was also issued.
    const earlierIssuedAt = new Date("2026-01-02T08:00:00Z");
    const laterIssuedAt = new Date("2026-01-05T08:00:00Z");
    const contact = await adminPool.query<{ id: string }>("select id from public.entity_contacts where entity_id = $1 and is_primary = true", [entityId]);
    await adminPool.query(
      "insert into public.rfi_requests (assessment_id, contact_id, status, issued_at) values ($1, $2, 'completed', $3), ($1, $2, 'cancelled', $4)",
      [assessmentId, contact.rows[0]!.id, earlierIssuedAt, laterIssuedAt],
    );

    // Portal uploads: the later "rfi_upload" is what "completed desktop
    // assessment date" reads. A later, differently-classed upload must
    // be ignored — proves the document_class filter, not just "latest
    // upload of any kind."
    const earlierUpload = new Date("2026-01-10T10:00:00Z");
    const laterUpload = new Date("2026-01-20T10:00:00Z");
    const evenLaterOtherUpload = new Date("2026-01-25T10:00:00Z");
    const uploader = assessorId;
    await adminPool.query(
      `insert into public.evidence_files (assessment_id, storage_path, original_name, mime_type, size_bytes, document_class, uploaded_by, uploaded_at)
       values
         ($1, 'a.pdf', 'a.pdf', 'application/pdf', 100, 'rfi_upload', $2, $3),
         ($1, 'b.pdf', 'b.pdf', 'application/pdf', 100, 'rfi_upload', $2, $4),
         ($1, 'c.pdf', 'c.pdf', 'application/pdf', 100, 'access_letter', $2, $5)`,
      [assessmentId, uploader, earlierUpload, laterUpload, evenLaterOtherUpload],
    );

    // Requirement decisions — written by a real authenticated assessor,
    // so decided_at is the trigger's own now(), not a value this test
    // can dictate.
    await asUser(authenticatedPool, assessorId, async (client) => {
      await client.query("insert into public.assessment_items (assessment_id, requirement_id, compliance_status) values ($1, $2, 'Compliant')", [
        assessmentId,
        requirement1!.id,
      ]);
      await client.query("insert into public.assessment_items (assessment_id, requirement_id, compliance_status) values ($1, $2, 'Not Compliant')", [
        assessmentId,
        requirement2!.id,
      ]);
    });
    const decidedAtRows = await adminPool.query<{ decided_at: Date }>("select decided_at from public.assessment_items where assessment_id = $1", [
      assessmentId,
    ]);
    const expectedReportCompletionDate = decidedAtRows.rows.map((r) => r.decided_at).sort((a, b) => b.getTime() - a.getTime())[0]!;

    const rows = await asUser(authenticatedPool, assessorId, (client) => pgTrackerRows(client, cycleId));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    expect(row.subjectCode).toBe("2026-EP-IN-TRK-1");
    expect(row.entityName).toBe("Tracker Test Co");
    expect(row.facilityName).toBeNull();
    expect(row.rfiIssueDate?.getTime()).toBe(earlierIssuedAt.getTime());
    expect(row.completedDesktopAssessmentDate?.getTime()).toBe(laterUpload.getTime());
    expect(row.officeVisitDate).toBe("2026-01-15");
    expect(row.completedVisitDate).toBe("2026-01-16");
    expect(row.reportCompletionDate?.getTime()).toBe(expectedReportCompletionDate.getTime());
    expect(row.reportQaCompletionDate?.getTime()).toBe(qaCompletedAt.getTime());
    expect(row.reportApprovalDate?.getTime()).toBe(approvedAt.getTime());
    expect(row.reportIssuanceDate?.getTime()).toBe(issuedAt.getTime());
    expect(row.contactName).toBe("Primary Contact");
    expect(row.contactEmail).toBe("primary@example.com");
    expect(row.contactPhone).toBe("+971500000000");

    expect(row.requirements).toHaveLength(2);
    const bySlNo = new Map(row.requirements.map((r) => [r.slNo, r]));
    expect(bySlNo.get(1)?.rating).toBe("Compliant");
    expect(bySlNo.get(2)?.rating).toBe("Not Compliant");
  });

  it("returns every row of a full 95-facility cycle without truncating, in reasonable time", async () => {
    const cycle = await adminPool.query<{ id: string }>("insert into public.cycles (year, name) values (2026, 'Tracker scale cycle') returning id");
    const cycleId = cycle.rows[0]!.id;

    const entity = await adminPool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Tracker Scale Co', 'TRK-SCALE-1', 'general_contractor') returning id",
    );
    const entityId = entity.rows[0]!.id;

    const template = await adminPool.query<{ id: string }>(
      "select id from public.checklist_templates where module = 'employment_practices' and is_active = true limit 1",
    );
    const templateId = template.rows[0]!.id;

    const ASSESSMENT_COUNT = 95;
    const values: string[] = [];
    const params: unknown[] = [];
    for (let i = 0; i < ASSESSMENT_COUNT; i++) {
      params.push("employment_practices", cycleId, entityId, templateId, `2026-EP-IN-TRK-SCALE-${i + 1}`, "initial");
      const base = params.length - 6;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
    }
    await adminPool.query(
      `insert into public.assessments (module, cycle_id, entity_id, template_id, subject_code, assessment_type) values ${values.join(", ")}`,
      params,
    );

    const start = performance.now();
    const rows = await asUser(authenticatedPool, assessorId, (client) => pgTrackerRows(client, cycleId));
    const elapsedMs = performance.now() - start;

    expect(rows).toHaveLength(ASSESSMENT_COUNT);
    expect(new Set(rows.map((r) => r.subjectCode)).size).toBe(ASSESSMENT_COUNT);
    expect(elapsedMs).toBeLessThan(5000);
  });
});
