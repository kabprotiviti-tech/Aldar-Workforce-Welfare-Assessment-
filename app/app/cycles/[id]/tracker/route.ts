import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadTrackerRowsForCycle } from "@/lib/tracker/export-supabase";
import { buildTrackerRows } from "@/lib/tracker/rows";
import { buildTrackerWorkbook } from "@/lib/tracker/workbook";

/**
 * GET /app/cycles/[id]/tracker — the Excel project tracker for one cycle
 * (this prompt: "the tracker exports for a full 95-facility cycle in one
 * file"). Reads go through the caller's own session, so `is_staff()`
 * RLS on `assessments`/`entities`/etc. (`lib/tracker/export-supabase.ts`)
 * is what actually keeps a non-staff signed-in user (e.g. client_viewer)
 * from pulling this file, the same reasoning as every other tracker/
 * report read in this app.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { data: cycle, error: cycleError } = await supabase.from("cycles").select("name, year").eq("id", id).is("deleted_at", null).maybeSingle();
  if (cycleError) {
    return NextResponse.json({ error: cycleError.message }, { status: 500 });
  }
  if (!cycle) {
    return NextResponse.json({ error: "Cycle not found." }, { status: 404 });
  }

  const trackerRows = await loadTrackerRowsForCycle(supabase, id);
  const bytes = await buildTrackerWorkbook(buildTrackerRows(trackerRows));
  const filename = `${cycle.name.replace(/[^a-z0-9]+/gi, "-")}-tracker.xlsx`;

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
