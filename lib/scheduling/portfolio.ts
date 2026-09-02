import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbModule } from "@/lib/db/common";
import type { AssessmentStage } from "@/lib/db/assessments";

export interface PortfolioRow {
  id: string;
  subjectCode: string;
  entityName: string;
  facilityName: string | null;
  stage: AssessmentStage;
  status: string;
  ownerId: string | null;
  ownerName: string | null;
  reportDueDate: string | null;
  isOverdue: boolean;
}

export interface PortfolioFilter {
  module: DbModule;
  stage?: AssessmentStage;
  /** A user id, or the literal "unassigned" for owner_id is null. */
  ownerId?: string;
  overdueOnly?: boolean;
}

/**
 * Portfolio view per module — filter by stage, owner, overdue (this
 * prompt). "Overdue" reads as: has a stored report_due_date in the past
 * and the assessment hasn't reached its final stage yet — a completed
 * assessment with a due date in the past is done, not overdue.
 *
 * assessments.owner_id references auth.users, which PostgREST doesn't
 * expose for embedding — owner names come from a second query against
 * public.users (which shares the same id) rather than a FK-embedded
 * select. entity_id/facility_id *are* embeddable (both point within the
 * public schema), so those use PostgREST's normal embed syntax.
 */
export async function listPortfolio(supabase: SupabaseClient, filter: PortfolioFilter): Promise<PortfolioRow[]> {
  let query = supabase
    .from("assessments")
    .select("id, subject_code, stage, status, owner_id, report_due_date, entities(name), facilities(name)")
    .eq("module", filter.module)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (filter.stage) {
    query = query.eq("stage", filter.stage);
  }
  if (filter.ownerId === "unassigned") {
    query = query.is("owner_id", null);
  } else if (filter.ownerId) {
    query = query.eq("owner_id", filter.ownerId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const ownerIds = Array.from(new Set((data ?? []).map((r) => r.owner_id as string | null).filter((id): id is string => id !== null)));
  const ownerNameById = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: owners, error: ownersError } = await supabase.from("users").select("id, full_name").in("id", ownerIds);
    if (ownersError) throw ownersError;
    for (const owner of owners ?? []) {
      ownerNameById.set(owner.id as string, owner.full_name as string);
    }
  }

  /** PostgREST returns a many-to-one embed as a single object, but without generated Database types this reads as `unknown`. */
  function embeddedName(value: unknown): string | null {
    if (Array.isArray(value)) {
      return (value[0] as { name?: string } | undefined)?.name ?? null;
    }
    return (value as { name?: string } | null)?.name ?? null;
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const rows: PortfolioRow[] = (data ?? []).map((r) => {
    const reportDueDate = (r.report_due_date as string | null) ?? null;
    const stage = r.stage as AssessmentStage;
    const status = r.status as string;
    const isOverdue = reportDueDate !== null && reportDueDate < todayIso && stage !== "monitor" && status !== "completed";
    const ownerId = (r.owner_id as string | null) ?? null;
    return {
      id: r.id as string,
      subjectCode: r.subject_code as string,
      entityName: embeddedName(r.entities) ?? "—",
      facilityName: embeddedName(r.facilities),
      stage,
      status,
      ownerId,
      ownerName: ownerId ? ownerNameById.get(ownerId) ?? null : null,
      reportDueDate,
      isOverdue,
    };
  });

  return filter.overdueOnly ? rows.filter((r) => r.isOverdue) : rows;
}
