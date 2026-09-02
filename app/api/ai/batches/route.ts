import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enqueueBatch } from "@/lib/ai/queue";
import { supabaseQueueDb } from "@/lib/ai/queue-supabase";
import { runExtractionBatch } from "@/lib/ai/run-extraction";

const bodySchema = z.object({
  assessmentId: z.string().uuid(),
  evidenceFileIds: z.array(z.string().uuid()).min(1).max(50),
});

/**
 * POST /api/ai/batches — starts extracting a batch of evidence files in
 * the background (this prompt: "a queue so a batch of 18 documents
 * extracts in the background with visible progress"). Returns as soon as
 * the queue rows exist; runExtractionBatch keeps running after the
 * response via next/server's after().
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "assessmentId and at least one evidenceFileId are required." }, { status: 400 });
  }

  // RLS confirms this staff member can actually see these evidence files
  // before anything is queued — same authorization shape as
  // lib/evidence/actions.ts's requestEvidenceUpload.
  const { data: files, error: filesError } = await supabase
    .from("evidence_files")
    .select("id")
    .eq("assessment_id", parsed.data.assessmentId)
    .in("id", parsed.data.evidenceFileIds);
  if (filesError) {
    return NextResponse.json({ error: filesError.message }, { status: 500 });
  }
  const visibleIds = (files ?? []).map((f) => f.id as string);
  if (visibleIds.length === 0) {
    return NextResponse.json({ error: "No matching evidence files found for this assessment." }, { status: 404 });
  }

  const { batchId, jobCount } = await enqueueBatch(supabaseQueueDb(), {
    evidenceFileIds: visibleIds,
    createdBy: userData.user.id,
  });

  after(() => runExtractionBatch(batchId));

  return NextResponse.json({ batchId, jobCount });
}
