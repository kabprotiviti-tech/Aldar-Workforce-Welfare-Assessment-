import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueBatch, runBatch, type ClaimedJob, type QueueDb } from "@/lib/ai/queue";
import type { CallClaudeFn, ExtractionDb } from "@/lib/ai/extract";
import { ADMIN_DATABASE_URL, isReachable, resetAndMigrate } from "./helpers";

/**
 * Acceptance criteria (this prompt): "A queue so a batch of 18 documents
 * extracts in the background with visible progress." Runs the real
 * lib/ai/queue.ts + lib/ai/extract.ts orchestration end-to-end — through
 * the real claim_next_extraction_job SQL function
 * (0020_claim_extraction_job.sql), not a mock — against a real Postgres
 * instance, the same pattern as tests/db/rfi-portal.test.ts.
 */
function pgQueueDb(pool: Pool): QueueDb {
  return {
    async insertJobs(input) {
      if (input.evidenceFileIds.length === 0) return 0;
      const values = input.evidenceFileIds.map((_, i) => `($1, $${i + 2}, $${input.evidenceFileIds.length + 2})`).join(", ");
      const result = await pool.query(
        `insert into public.extraction_jobs (batch_id, evidence_file_id, created_by) values ${values} returning id`,
        [input.batchId, ...input.evidenceFileIds, input.createdBy],
      );
      return result.rows.length;
    },
    async claimNextJob(batchId): Promise<ClaimedJob | null> {
      const { rows } = await pool.query("select * from public.claim_next_extraction_job($1)", [batchId]);
      const row = rows[0];
      if (!row) return null;
      return {
        jobId: row.job_id,
        evidenceFileId: row.evidence_file_id,
        documentClass: row.document_class,
        storagePath: row.storage_path,
        mimeType: row.mime_type,
      };
    },
    async markJobSucceeded(jobId, extractionId) {
      await pool.query("update public.extraction_jobs set status = 'succeeded', extraction_id = $2, finished_at = now() where id = $1", [jobId, extractionId]);
    },
    async markJobFailed(jobId, error) {
      await pool.query("update public.extraction_jobs set status = 'failed', error = $2, finished_at = now() where id = $1", [jobId, error]);
    },
    async getBatchProgress(batchId) {
      const { rows } = await pool.query("select status, count(*)::int as n from public.extraction_jobs where batch_id = $1 group by status", [batchId]);
      const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
      return {
        batchId,
        total: rows.reduce((sum, r) => sum + r.n, 0),
        queued: byStatus.queued ?? 0,
        running: byStatus.running ?? 0,
        succeeded: byStatus.succeeded ?? 0,
        failed: byStatus.failed ?? 0,
      };
    },
  };
}

function pgExtractionDb(pool: Pool): ExtractionDb {
  return {
    async insertExtraction(input) {
      const { rows } = await pool.query(
        `insert into public.extractions (evidence_file_id, model, prompt_version, raw_response, input_tokens, output_tokens, cost_usd, error)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [input.evidenceFileId, input.model, input.promptVersion, input.rawResponse, input.inputTokens, input.outputTokens, input.costUsd, input.error],
      );
      return { extractionId: rows[0]!.id };
    },
    async insertFacts(input) {
      if (input.facts.length === 0) return 0;
      let count = 0;
      for (const fact of input.facts) {
        await pool.query(
          `insert into public.extracted_facts
             (extraction_id, evidence_file_id, fact_key, value_text, value_number, value_date, value_boolean, value_json,
              unit, page_ref, verbatim_quote, confidence, reason, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'proposed')`,
          [
            input.extractionId,
            input.evidenceFileId,
            fact.factKey,
            fact.valueText,
            fact.valueNumber,
            fact.valueDate,
            fact.valueBoolean,
            fact.valueJson === null || fact.valueJson === undefined ? null : JSON.stringify(fact.valueJson),
            fact.unit,
            fact.pageRef,
            fact.verbatimQuote,
            fact.confidence,
            fact.reason,
          ],
        );
        count += 1;
      }
      return count;
    },
  };
}

const pool = new Pool({ connectionString: ADMIN_DATABASE_URL });
const reachable = await isReachable(pool);

if (!reachable) {
  console.warn(`Skipping extraction queue test — no Postgres reachable at ${ADMIN_DATABASE_URL}.`);
}

describe.skipIf(!reachable)("extraction queue: batch progress accounting against real Postgres", () => {
  let assessmentId: string;
  let wpsFileId1: string;
  let wpsFileId2: string;
  let photoFileId: string;

  beforeAll(async () => {
    await resetAndMigrate(pool);

    const uploader = await pool.query<{ id: string }>("insert into auth.users default values returning id");
    const uploaderId = uploader.rows[0]!.id;

    const cycle = await pool.query<{ id: string }>("insert into public.cycles (year, name) values (2026, 'Extraction test cycle') returning id");
    const template = await pool.query<{ id: string }>(
      `insert into public.checklist_templates (module, version, effective_from, is_active)
       values ('employment_practices', 301, current_date, true) returning id`,
    );
    const entity = await pool.query<{ id: string }>(
      "insert into public.entities (name, entity_code, type) values ('Extraction Test Entity', 'EXT-TEST-1', 'general_contractor') returning id",
    );
    const assessment = await pool.query<{ id: string }>(
      `insert into public.assessments (module, cycle_id, entity_id, template_id, subject_code, assessment_type)
       values ('employment_practices', $1, $2, $3, '2026-EP-IN-EXT-TEST-1', 'initial')
       returning id`,
      [cycle.rows[0]!.id, entity.rows[0]!.id, template.rows[0]!.id],
    );
    assessmentId = assessment.rows[0]!.id;

    async function insertEvidenceFile(name: string, documentClass: string, mimeType: string): Promise<string> {
      const result = await pool.query<{ id: string }>(
        `insert into public.evidence_files (assessment_id, storage_path, original_name, mime_type, size_bytes, document_class, uploaded_by)
         values ($1, $2, $3, $4, 1024, $5, $6) returning id`,
        [assessmentId, `evidence/${assessmentId}/${name}`, name, mimeType, documentClass, uploaderId],
      );
      return result.rows[0]!.id;
    }

    wpsFileId1 = await insertEvidenceFile("wps-1.pdf", "wps_report", "application/pdf");
    wpsFileId2 = await insertEvidenceFile("wps-2.pdf", "wps_report", "application/pdf");
    // "photo" has no registered v1 prompt — proves a batch surfaces that as a
    // failed job (this prompt's "extraction failed, review manually"), not a crash.
    photoFileId = await insertEvidenceFile("site-photo.jpg", "photo", "image/jpeg");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("enqueues one job per file and reports queued progress before anything runs", async () => {
    const queueDb = pgQueueDb(pool);
    const { batchId, jobCount } = await enqueueBatch(queueDb, { evidenceFileIds: [wpsFileId1, wpsFileId2, photoFileId], createdBy: null });

    expect(jobCount).toBe(3);
    const progress = await queueDb.getBatchProgress(batchId);
    expect(progress).toEqual({ batchId, total: 3, queued: 3, running: 0, succeeded: 0, failed: 0 });
  });

  it("runs a full batch to completion: two succeed with fanned-out facts, one fails without calling the model", async () => {
    const queueDb = pgQueueDb(pool);
    const extractionDb = pgExtractionDb(pool);
    const { batchId } = await enqueueBatch(queueDb, { evidenceFileIds: [wpsFileId1, wpsFileId2, photoFileId], createdBy: null });

    let modelCallCount = 0;
    const callClaude: CallClaudeFn = async () => {
      modelCallCount += 1;
      return {
        text: JSON.stringify({
          facts: [{ fact_key: "wps_transfer_date", value: "2026-05-01", unit: null, page_ref: "page 1", verbatim_quote: "Transfer Date: 01/05/2026", confidence: "high", reason: null }],
        }),
        model: "claude-sonnet-4-6",
        inputTokens: 1000,
        outputTokens: 100,
      };
    };

    await runBatch(queueDb, extractionDb, callClaude, async () => ({ base64Data: "ZmFrZS1wZGYtYnl0ZXM=" }), batchId);

    // Only the two wps_report jobs have a registered prompt — the photo job is
    // never sent to the model at all.
    expect(modelCallCount).toBe(2);

    const progress = await queueDb.getBatchProgress(batchId);
    expect(progress).toEqual({ batchId, total: 3, queued: 0, running: 0, succeeded: 2, failed: 1 });

    const jobs = await pool.query(
      `select j.evidence_file_id, j.status, j.error, e.cost_usd
       from public.extraction_jobs j left join public.extractions e on e.id = j.extraction_id
       where j.batch_id = $1`,
      [batchId],
    );
    const byFile = Object.fromEntries(jobs.rows.map((r) => [r.evidence_file_id, r]));

    expect(byFile[wpsFileId1].status).toBe("succeeded");
    expect(Number(byFile[wpsFileId1].cost_usd)).toBeGreaterThan(0);
    expect(byFile[wpsFileId2].status).toBe("succeeded");
    expect(byFile[photoFileId].status).toBe("failed");
    expect(byFile[photoFileId].error).toMatch(/photo/);

    const facts = await pool.query("select fact_key, status from public.extracted_facts where evidence_file_id in ($1, $2)", [wpsFileId1, wpsFileId2]);
    expect(facts.rows).toHaveLength(2);
    expect(facts.rows.every((r) => r.fact_key === "wps_transfer_date" && r.status === "proposed")).toBe(true);
  });

  it("claim_next_extraction_job never hands the same job to two concurrent claimers", async () => {
    const queueDb = pgQueueDb(pool);
    const { batchId } = await enqueueBatch(queueDb, { evidenceFileIds: [wpsFileId1, wpsFileId2], createdBy: null });

    const [first, second] = await Promise.all([queueDb.claimNextJob(batchId), queueDb.claimNextJob(batchId)]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.jobId).not.toBe(second!.jobId);

    const third = await queueDb.claimNextJob(batchId);
    expect(third).toBeNull();
  });
});
