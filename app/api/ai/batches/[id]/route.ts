import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ExtractionJobStatus = "queued" | "running" | "succeeded" | "failed";

/**
 * GET /api/ai/batches/[id] — batch progress, polled by the UI (this
 * prompt: "visible progress", "cost per document is visible in the UI").
 * Reads through the session-scoped client, so the existing
 * extraction_jobs/extractions RLS staff-select policies (0005/0008) are
 * the authorization check — no separate ownership lookup needed.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: batchId } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("extraction_jobs")
    .select("evidence_file_id, status, error, extractions(cost_usd)")
    .eq("batch_id", batchId)
    .order("created_at");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Batch not found." }, { status: 404 });
  }

  const jobs = data.map((row) => {
    const extraction = row.extractions as { cost_usd: number | null } | { cost_usd: number | null }[] | null;
    const costUsd = Array.isArray(extraction) ? (extraction[0]?.cost_usd ?? null) : (extraction?.cost_usd ?? null);
    return {
      evidenceFileId: row.evidence_file_id as string,
      status: row.status as ExtractionJobStatus,
      error: row.error as string | null,
      costUsd,
    };
  });

  const counts: Record<ExtractionJobStatus, number> = { queued: 0, running: 0, succeeded: 0, failed: 0 };
  for (const job of jobs) counts[job.status] += 1;
  const totalCostUsd = jobs.reduce((sum, job) => sum + (job.costUsd ?? 0), 0);

  return NextResponse.json({
    batchId,
    total: jobs.length,
    ...counts,
    totalCostUsd,
    done: counts.queued === 0 && counts.running === 0,
    jobs,
  });
}
