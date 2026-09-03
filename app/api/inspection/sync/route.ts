import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const mutationSchema = z.object({
  clientMutationId: z.string().uuid(),
  assessmentId: z.string().uuid(),
  kind: z.enum(["area_answer", "area_quantitative", "area_rating", "room_count", "photo", "certificate"]),
  payload: z.record(z.string(), z.unknown()),
});

const bodySchema = z.object({
  // Bounded so one request can't be an unbounded batch, but generous
  // enough that a full day's queue drains in a handful of round trips.
  mutations: z.array(mutationSchema).min(1).max(50),
});

/**
 * POST /api/inspection/sync — applies queued inspection mutations.
 *
 * Exactly-once lives in the database, not here: each mutation goes
 * through apply_inspection_mutation (0025_inspection_sync.sql), which
 * claims the client's mutation id and does the work in one transaction.
 * A replay is reported as a duplicate and changes nothing, which is what
 * lets the client retry freely on a bad connection.
 *
 * Each mutation is applied independently and reported on independently:
 * one bad row in a batch of fifty must not roll back the other
 * forty-nine, because the assessor would then be stuck retrying a batch
 * that can never succeed.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected between 1 and 50 inspection mutations." }, { status: 400 });
  }

  const results: { clientMutationId: string; ok: boolean; duplicate: boolean; error?: string }[] = [];

  for (const mutation of parsed.data.mutations) {
    const { data, error } = await supabase.rpc("apply_inspection_mutation", {
      p_client_mutation_id: mutation.clientMutationId,
      p_assessment_id: mutation.assessmentId,
      p_kind: mutation.kind,
      p_payload: mutation.payload,
    });

    if (error) {
      results.push({ clientMutationId: mutation.clientMutationId, ok: false, duplicate: false, error: error.message });
      continue;
    }

    const applied = data as { applied: boolean; duplicate: boolean } | null;
    results.push({
      clientMutationId: mutation.clientMutationId,
      ok: true,
      duplicate: applied?.duplicate ?? false,
    });
  }

  return NextResponse.json({ results, applied: results.filter((r) => r.ok && !r.duplicate).length });
}
