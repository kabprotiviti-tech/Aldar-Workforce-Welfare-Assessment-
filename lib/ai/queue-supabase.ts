import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { BatchProgress, ClaimedJob, FetchFileFn, QueueDb } from "@/lib/ai/queue";

/**
 * Real adapter for extraction_jobs — always the service-role client, same
 * reasoning as lib/ai/extract-supabase.ts. claimNextJob calls the
 * claim_next_extraction_job SQL function (0020_claim_extraction_job.sql)
 * so the claim-and-mark-running step stays a single atomic round trip
 * (FOR UPDATE SKIP LOCKED) rather than a read-then-write race across two
 * separate PostgREST calls. Kept apart from lib/ai/queue.ts's pure
 * orchestration so a test never drags in "server-only" — see
 * lib/rfi/portal.ts / lib/rfi/portal-supabase.ts for the precedent.
 */
export function supabaseQueueDb(supabase: SupabaseClient = createSupabaseAdminClient()): QueueDb {
  return {
    async insertJobs(input) {
      if (input.evidenceFileIds.length === 0) return 0;
      const { data, error } = await supabase
        .from("extraction_jobs")
        .insert(
          input.evidenceFileIds.map((evidenceFileId) => ({
            batch_id: input.batchId,
            evidence_file_id: evidenceFileId,
            created_by: input.createdBy,
          })),
        )
        .select("id");
      if (error) throw error;
      return data?.length ?? 0;
    },

    async claimNextJob(batchId): Promise<ClaimedJob | null> {
      const { data, error } = await supabase.rpc("claim_next_extraction_job", { p_batch_id: batchId });
      if (error) throw error;
      const row = data?.[0];
      if (!row) return null;
      return {
        jobId: row.job_id as string,
        evidenceFileId: row.evidence_file_id as string,
        documentClass: (row.document_class as string | null) ?? null,
        storagePath: row.storage_path as string,
        mimeType: row.mime_type as string,
      };
    },

    async markJobSucceeded(jobId, extractionId) {
      const { error } = await supabase
        .from("extraction_jobs")
        .update({ status: "succeeded", extraction_id: extractionId, finished_at: new Date().toISOString() })
        .eq("id", jobId);
      if (error) throw error;
    },

    async markJobFailed(jobId, errorMessage) {
      const { error } = await supabase
        .from("extraction_jobs")
        .update({ status: "failed", error: errorMessage, finished_at: new Date().toISOString() })
        .eq("id", jobId);
      if (error) throw error;
    },

    async getBatchProgress(batchId): Promise<BatchProgress> {
      const { data, error } = await supabase.from("extraction_jobs").select("status").eq("batch_id", batchId);
      if (error) throw error;
      const rows = data ?? [];
      return {
        batchId,
        total: rows.length,
        queued: rows.filter((r) => r.status === "queued").length,
        running: rows.filter((r) => r.status === "running").length,
        succeeded: rows.filter((r) => r.status === "succeeded").length,
        failed: rows.filter((r) => r.status === "failed").length,
      };
    },
  };
}

/**
 * A job stuck "running" this long almost certainly belongs to a
 * background run (next/server's after()) that a serverless duration
 * limit killed mid-batch, rather than one still genuinely in flight —
 * lib/ai/client.ts's own REQUEST_TIMEOUT_MS is 120s per call.
 */
const STUCK_JOB_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Requeues jobs left "running" past the stuck threshold, so
 * app/api/ai/sweep-stuck-jobs can retry them. Uses the
 * extraction_jobs_status_started_at_idx index (0019). Returns the
 * distinct batch_ids touched, since requeuing alone doesn't resume
 * processing — nothing is left calling claimNextJob for that batch until
 * the caller re-runs runExtractionBatch for each one.
 */
export async function requeueStuckExtractionJobs(supabase: SupabaseClient = createSupabaseAdminClient()): Promise<{ requeued: number; batchIds: string[] }> {
  const cutoff = new Date(Date.now() - STUCK_JOB_THRESHOLD_MS).toISOString();
  const { data, error } = await supabase
    .from("extraction_jobs")
    .update({ status: "queued", started_at: null })
    .eq("status", "running")
    .lt("started_at", cutoff)
    .select("batch_id");
  if (error) throw error;
  const rows = data ?? [];
  return { requeued: rows.length, batchIds: [...new Set(rows.map((r) => r.batch_id as string))] };
}

/** Downloads one evidence file's bytes from Storage and returns them as base64, ready for an Anthropic document/image block. */
export function supabaseFetchFile(supabase: SupabaseClient = createSupabaseAdminClient()): FetchFileFn {
  return async ({ storagePath }) => {
    const { data, error } = await supabase.storage.from("evidence").download(storagePath);
    if (error) throw error;
    const buffer = Buffer.from(await data.arrayBuffer());
    return { base64Data: buffer.toString("base64") };
  };
}
