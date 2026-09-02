"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateAssessmentSet, supabaseGenerateCycleDb } from "@/lib/scheduling/generate-cycle";
import type { DbModule } from "@/lib/db/common";

export async function openCycle(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const year = Number.parseInt(String(formData.get("year") ?? ""), 10);
  const name = String(formData.get("name") ?? "").trim();
  const { data, error } = await supabase.from("cycles").insert({ year, name }).select("id").single();
  if (error) {
    redirect(`/app/cycles?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/app/cycles");
  redirect(`/app/cycles/${data.id}`);
}

export async function closeCycle(cycleId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("cycles").update({ closed_at: new Date().toISOString() }).eq("id", cycleId);
  if (error) {
    redirect(`/app/cycles/${cycleId}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/app/cycles/${cycleId}`);
  redirect(`/app/cycles/${cycleId}`);
}

/**
 * Generates one assessment per active entity/facility for a module that
 * doesn't already have one in this cycle (lib/scheduling/generate-cycle.ts
 * — see there for how the acceptance criterion, 95 facilities under 5
 * seconds, is met and proven).
 */
export async function generateAssessmentSetForCycle(
  cycleId: string,
  cycleYear: number,
  module: DbModule,
): Promise<void> {
  const supabase = await createSupabaseServerClient();

  // redirect() throws internally — it must never land inside this try, or
  // Next.js's own redirect signal would be caught below and misreported as
  // a generation failure. Only the query itself is guarded.
  let outcome: { kind: "success"; message: string } | { kind: "error"; message: string };
  try {
    const result = await generateAssessmentSet(supabaseGenerateCycleDb(supabase), { cycleId, cycleYear, module });
    outcome = {
      kind: "success",
      message: `Generated ${result.created} assessment${result.created === 1 ? "" : "s"} for ${module} (${result.skipped} already had one this cycle).`,
    };
  } catch (error) {
    outcome = { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }

  if (outcome.kind === "success") {
    revalidatePath(`/app/cycles/${cycleId}`);
  }
  redirect(`/app/cycles/${cycleId}?${outcome.kind}=${encodeURIComponent(outcome.message)}`);
}
