import { randomUUID } from "node:crypto";
import { extractDocument, type ExtractionContentLike, type ExtractionDb, type CallClaudeFn } from "@/lib/ai/extract";

/**
 * The document extraction batch queue (this prompt: "a queue so a batch
 * of 18 documents extracts in the background with visible progress").
 * Pure orchestration over an injected QueueDb/CallClaudeFn/FetchFileFn —
 * no "server-only", no Supabase/Anthropic client construction — same
 * ports-and-adapters split as lib/ai/extract.ts and
 * lib/scheduling/generate-cycle.ts. The real adapter lives in
 * lib/ai/queue-supabase.ts; the route handler in app/api/ai/batches
 * drives runBatch from inside next/server's after(). See docs/decisions.md.
 */

export interface ClaimedJob {
  jobId: string;
  evidenceFileId: string;
  documentClass: string | null;
  storagePath: string;
  mimeType: string;
}

export interface BatchProgress {
  batchId: string;
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
}

export interface QueueDb {
  /** Inserts one queued row per evidence file, all sharing batchId. Returns the row count. */
  insertJobs(input: { batchId: string; evidenceFileIds: string[]; createdBy: string | null }): Promise<number>;
  /** Atomically claims the oldest still-queued job in the batch, marking it running. Null once the batch is drained. */
  claimNextJob(batchId: string): Promise<ClaimedJob | null>;
  markJobSucceeded(jobId: string, extractionId: string): Promise<void>;
  markJobFailed(jobId: string, error: string): Promise<void>;
  getBatchProgress(batchId: string): Promise<BatchProgress>;
}

export type FetchFileFn = (input: { storagePath: string; mimeType: string }) => Promise<{ base64Data: string }>;

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

/**
 * Not every accepted evidence upload is one Claude can read visually —
 * lib/evidence/upload-validation.ts also allows xlsx/docx/zip, which have
 * no document/image block equivalent. Those are failed with a clear
 * reason (this prompt's "surfaced as ... review manually" fallback)
 * before ever calling the model.
 */
export function buildExtractionContent(mimeType: string, base64Data: string): ExtractionContentLike | null {
  if (mimeType === "application/pdf") return { kind: "pdf", base64Data };
  if (IMAGE_MIME_TYPES.has(mimeType)) return { kind: "image", mediaType: mimeType, base64Data };
  return null;
}

export async function enqueueBatch(
  queueDb: QueueDb,
  input: { evidenceFileIds: string[]; createdBy: string | null },
): Promise<{ batchId: string; jobCount: number }> {
  const batchId = randomUUID();
  const jobCount = await queueDb.insertJobs({ batchId, evidenceFileIds: input.evidenceFileIds, createdBy: input.createdBy });
  return { batchId, jobCount };
}

/** Claims and processes exactly one job. Never throws — every failure mode is recorded on the job itself. */
export async function processNextJob(
  queueDb: QueueDb,
  extractionDb: ExtractionDb,
  callClaude: CallClaudeFn,
  fetchFile: FetchFileFn,
  batchId: string,
): Promise<"processed" | "empty"> {
  const job = await queueDb.claimNextJob(batchId);
  if (!job) return "empty";

  try {
    const { base64Data } = await fetchFile({ storagePath: job.storagePath, mimeType: job.mimeType });
    const content = buildExtractionContent(job.mimeType, base64Data);
    if (!content) {
      await queueDb.markJobFailed(job.jobId, `This file type ("${job.mimeType}") can't be read for extraction — review manually.`);
      return "processed";
    }

    const result = await extractDocument(extractionDb, callClaude, {
      evidenceFileId: job.evidenceFileId,
      documentClass: job.documentClass,
      content,
    });

    if (result.outcome === "succeeded") {
      await queueDb.markJobSucceeded(job.jobId, result.extractionId);
    } else if (result.outcome === "failed") {
      await queueDb.markJobFailed(job.jobId, result.error);
    } else {
      await queueDb.markJobFailed(job.jobId, result.reason);
    }
  } catch (err) {
    await queueDb.markJobFailed(job.jobId, err instanceof Error ? err.message : String(err));
  }

  return "processed";
}

/**
 * Drains a batch sequentially — one document at a time, not in parallel.
 * That keeps a single background run (next/server's after(), which this
 * function is invoked from) within one predictable concurrency budget
 * against the Anthropic API, rather than needing a separate limiter for
 * up to 18 simultaneous requests.
 */
export async function runBatch(
  queueDb: QueueDb,
  extractionDb: ExtractionDb,
  callClaude: CallClaudeFn,
  fetchFile: FetchFileFn,
  batchId: string,
): Promise<void> {
  while ((await processNextJob(queueDb, extractionDb, callClaude, fetchFile, batchId)) !== "empty") {
    // Keep draining until claimNextJob finds nothing left queued.
  }
}
