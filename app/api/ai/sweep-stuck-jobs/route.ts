import { NextResponse, after, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env/server";
import { requeueStuckExtractionJobs } from "@/lib/ai/queue-supabase";
import { runExtractionBatch } from "@/lib/ai/run-extraction";

/**
 * Triggered by Vercel Cron (vercel.json), same "Authorization: Bearer
 * <CRON_SECRET>" pattern as app/api/rfi/reminders. Resilience net for a
 * batch's background run (next/server's after(), app/api/ai/batches)
 * getting killed mid-document by a serverless duration limit — requeues
 * anything left "running" past the stuck threshold, then resumes
 * processing for each affected batch (requeuing alone wouldn't restart
 * the drain loop) via after(), the same way starting a batch does.
 */
export async function GET(request: NextRequest) {
  const provided = request.headers.get("authorization");
  if (!serverEnv.CRON_SECRET || provided !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { requeued, batchIds } = await requeueStuckExtractionJobs();
  after(() => Promise.all(batchIds.map((batchId) => runExtractionBatch(batchId))));

  return NextResponse.json({ requeued, batchIds });
}
