import { describe, expect, it, vi } from "vitest";
import { buildExtractionContent, processNextJob, runBatch, type ClaimedJob, type QueueDb } from "./queue";
import type { CallClaudeFn, ExtractionDb } from "./extract";

function fakeExtractionDb(): ExtractionDb {
  let counter = 0;
  return {
    async insertExtraction() {
      counter += 1;
      return { extractionId: `extraction-${counter}` };
    },
    async insertFacts(input) {
      return input.facts.length;
    },
  };
}

function fakeQueueDb(jobs: ClaimedJob[]): QueueDb & { succeeded: Array<{ jobId: string; extractionId: string }>; failed: Array<{ jobId: string; error: string }> } {
  const queue = [...jobs];
  const succeeded: Array<{ jobId: string; extractionId: string }> = [];
  const failed: Array<{ jobId: string; error: string }> = [];
  return {
    succeeded,
    failed,
    async insertJobs(input) {
      return input.evidenceFileIds.length;
    },
    async claimNextJob() {
      return queue.shift() ?? null;
    },
    async markJobSucceeded(jobId, extractionId) {
      succeeded.push({ jobId, extractionId });
    },
    async markJobFailed(jobId, error) {
      failed.push({ jobId, error });
    },
    async getBatchProgress(batchId) {
      return { batchId, total: 0, queued: 0, running: 0, succeeded: 0, failed: 0 };
    },
  };
}

describe("buildExtractionContent", () => {
  it("maps application/pdf to a pdf content block", () => {
    expect(buildExtractionContent("application/pdf", "abc")).toEqual({ kind: "pdf", base64Data: "abc" });
  });

  it("maps image/jpeg and image/png to image content blocks", () => {
    expect(buildExtractionContent("image/jpeg", "abc")).toEqual({ kind: "image", mediaType: "image/jpeg", base64Data: "abc" });
    expect(buildExtractionContent("image/png", "abc")).toEqual({ kind: "image", mediaType: "image/png", base64Data: "abc" });
  });

  it("returns null for a mime type Claude can't read visually (e.g. xlsx)", () => {
    expect(buildExtractionContent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "abc")).toBeNull();
  });
});

describe("processNextJob", () => {
  const job: ClaimedJob = { jobId: "job-1", evidenceFileId: "ev-1", documentClass: "wps_report", storagePath: "evidence/x.pdf", mimeType: "application/pdf" };

  it("returns 'empty' and touches nothing when the queue is drained", async () => {
    const queueDb = fakeQueueDb([]);
    const callClaude = vi.fn();

    const outcome = await processNextJob(queueDb, fakeExtractionDb(), callClaude, async () => ({ base64Data: "x" }), "batch-1");

    expect(outcome).toBe("empty");
    expect(callClaude).not.toHaveBeenCalled();
  });

  it("fails the job without calling the model for an unsupported file type", async () => {
    const queueDb = fakeQueueDb([{ ...job, mimeType: "application/zip" }]);
    const callClaude = vi.fn();

    const outcome = await processNextJob(queueDb, fakeExtractionDb(), callClaude, async () => ({ base64Data: "x" }), "batch-1");

    expect(outcome).toBe("processed");
    expect(callClaude).not.toHaveBeenCalled();
    expect(queueDb.failed).toHaveLength(1);
    expect(queueDb.failed[0]!.jobId).toBe("job-1");
  });

  it("marks the job succeeded on a valid extraction", async () => {
    const queueDb = fakeQueueDb([job]);
    const callClaude: CallClaudeFn = async () => ({
      text: JSON.stringify({ facts: [{ fact_key: "wps_transfer_date", value: "2026-05-01", unit: null, page_ref: null, verbatim_quote: "x", confidence: "high", reason: null }] }),
      model: "claude-sonnet-4-6",
      inputTokens: 100,
      outputTokens: 50,
    });

    const outcome = await processNextJob(queueDb, fakeExtractionDb(), callClaude, async () => ({ base64Data: "x" }), "batch-1");

    expect(outcome).toBe("processed");
    expect(queueDb.succeeded).toHaveLength(1);
    expect(queueDb.failed).toHaveLength(0);
  });

  it("marks the job failed (never throws) when the model response is malformed", async () => {
    const queueDb = fakeQueueDb([job]);
    const callClaude: CallClaudeFn = async () => ({ text: "not json", model: "claude-sonnet-4-6", inputTokens: 10, outputTokens: 5 });

    const outcome = await processNextJob(queueDb, fakeExtractionDb(), callClaude, async () => ({ base64Data: "x" }), "batch-1");

    expect(outcome).toBe("processed");
    expect(queueDb.failed).toHaveLength(1);
    expect(queueDb.failed[0]!.error).toMatch(/not valid json/i);
  });

  it("marks the job failed (never throws) when fetching the file itself fails", async () => {
    const queueDb = fakeQueueDb([job]);

    const outcome = await processNextJob(
      queueDb,
      fakeExtractionDb(),
      async () => ({ text: "{}", model: "x", inputTokens: 0, outputTokens: 0 }),
      async () => {
        throw new Error("storage download failed");
      },
      "batch-1",
    );

    expect(outcome).toBe("processed");
    expect(queueDb.failed).toEqual([{ jobId: "job-1", error: "storage download failed" }]);
  });

  it("fails a job with no registered prompt (e.g. photo) without calling the model", async () => {
    const queueDb = fakeQueueDb([{ ...job, documentClass: "photo" }]);
    const callClaude = vi.fn();

    await processNextJob(queueDb, fakeExtractionDb(), callClaude, async () => ({ base64Data: "x" }), "batch-1");

    expect(callClaude).not.toHaveBeenCalled();
    expect(queueDb.failed).toHaveLength(1);
    expect(queueDb.failed[0]!.error).toMatch(/photo/);
  });
});

describe("runBatch", () => {
  it("drains every queued job, one at a time, until the queue is empty", async () => {
    const jobs: ClaimedJob[] = [1, 2, 3].map((n) => ({
      jobId: `job-${n}`,
      evidenceFileId: `ev-${n}`,
      documentClass: "wps_report",
      storagePath: `evidence/${n}.pdf`,
      mimeType: "application/pdf",
    }));
    const queueDb = fakeQueueDb(jobs);
    const callClaude: CallClaudeFn = async () => ({ text: JSON.stringify({ facts: [] }), model: "claude-sonnet-4-6", inputTokens: 10, outputTokens: 10 });

    await runBatch(queueDb, fakeExtractionDb(), callClaude, async () => ({ base64Data: "x" }), "batch-1");

    expect(queueDb.succeeded).toHaveLength(3);
    expect(queueDb.failed).toHaveLength(0);
  });
});
