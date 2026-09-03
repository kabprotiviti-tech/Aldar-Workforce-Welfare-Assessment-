import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadExecutiveOverview } from "@/lib/dashboard/executive-supabase";
import type { LifecycleStage } from "@/lib/dashboard/lifecycle";
import { Card } from "@/components/ds/card";
import { EmptyState } from "@/components/ds/empty-state";
import { ClientPortal, type PortalFindingRow, type PortalReportRow } from "@/components/portal/client-portal";

const MODULE_LABEL: Record<string, string> = {
  employment_practices: "Employment Practices",
  onboarding: "Onboarding",
  accommodation: "Accommodation",
};

function oneOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const STAGE_LABELS: Record<LifecycleStage, string> = {
  plan: "Plan",
  request: "Request",
  collect: "Collect",
  review: "Review",
  assess: "Assess",
  report: "Report",
  act: "Act",
  monitor: "Monitor",
};

export default async function AppHomePage({ searchParams }: { searchParams: Promise<{ cycle?: string }> }) {
  const { cycle: requestedCycleId } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: userData } = await supabase.auth.getUser();
  const { data: profile } = userData.user
    ? await supabase.from("users").select("role").eq("id", userData.user.id).maybeSingle()
    : { data: null };

  if (profile?.role === "client_viewer") {
    // RLS (reports_select_client_viewer / findings_select_client_viewer,
    // 0007_findings_reports.sql) already scopes both reads to this
    // viewer's own entity and to "approved"/"open" — see docs/schema.md.
    const [{ data: reportRows }, { data: findingRows }] = await Promise.all([
      supabase
        .from("reports")
        .select("id, version, storage_path, generated_at, assessments(subject_code, module)")
        .eq("is_current", true)
        .order("generated_at", { ascending: false }),
      supabase
        .from("findings")
        .select("id, title, priority, due_date, status, assessment_items(assessments(subject_code))")
        .order("due_date", { ascending: true, nullsFirst: false }),
    ]);

    const reports: PortalReportRow[] = await Promise.all(
      (reportRows ?? []).map(async (row) => {
        const assessment = oneOf(row.assessments as unknown as { subject_code: string; module: string } | { subject_code: string; module: string }[] | null);
        const { data: signed } = await supabase.storage.from("reports").createSignedUrl(row.storage_path as string, 300);
        return {
          id: row.id as string,
          subjectCode: assessment?.subject_code ?? "",
          moduleLabel: MODULE_LABEL[assessment?.module ?? ""] ?? "",
          version: row.version as number,
          generatedAt: row.generated_at as string,
          downloadUrl: signed?.signedUrl ?? null,
        };
      }),
    );

    const findings: PortalFindingRow[] = (findingRows ?? []).map((row) => {
      const item = oneOf(row.assessment_items as unknown as { assessments: unknown } | { assessments: unknown }[] | null);
      const assessment = oneOf(item?.assessments as unknown as { subject_code: string } | { subject_code: string }[] | null);
      return {
        id: row.id as string,
        subjectCode: assessment?.subject_code ?? "",
        title: row.title as string,
        priority: row.priority as PortalFindingRow["priority"],
        status: row.status as string,
        dueDate: (row.due_date as string | null) ?? null,
      };
    });

    return <ClientPortal reports={reports} findings={findings} />;
  }

  const { data: cycles } = await supabase.from("cycles").select("id, name").is("deleted_at", null).order("opened_at", { ascending: false });

  if (!cycles || cycles.length === 0) {
    return (
      <div>
        <h1 className="text-lg font-semibold text-ds-ink">Overview</h1>
        <div className="mt-6">
          <EmptyState title="No cycles yet" description="Open a cycle to see its lifecycle progress and attention list here." />
        </div>
      </div>
    );
  }

  const selectedCycleId = requestedCycleId && cycles.some((c) => c.id === requestedCycleId) ? requestedCycleId : cycles[0]!.id;
  const overview = await loadExecutiveOverview(supabase, selectedCycleId);
  const totalAssessments = overview.stageCounts.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ds-ink">Overview</h1>
          <p className="mt-1 text-sm text-ds-ink-2">
            {overview.cycleName} &middot; {totalAssessments} assessment{totalAssessments === 1 ? "" : "s"}
          </p>
        </div>
        <form method="get" className="flex items-center gap-2">
          <label className="text-sm text-ds-ink-2" htmlFor="cycle">
            Cycle
          </label>
          <select
            id="cycle"
            name="cycle"
            defaultValue={selectedCycleId}
            className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-2.5 py-1.5 text-sm text-ds-ink"
          >
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </form>
      </div>

      <div>
        <p className="text-sm font-medium text-ds-ink">Lifecycle</p>
        <p className="mt-1 text-xs text-ds-ink-2">
          Every assessment&apos;s stage, derived from what has actually happened to it — not a stored status nothing keeps current. Open a stage to see exactly which assessments are in it.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {overview.stageCounts.map((stageCount) => (
            <Card key={stageCount.stage}>
              <p className="text-2xl font-semibold text-ds-ink">{stageCount.count}</p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-ds-ink-2">{STAGE_LABELS[stageCount.stage]}</p>
              {stageCount.count > 0 && (
                <details className="mt-2">
                  <summary className="ds-focus-ring cursor-pointer text-xs text-ds-accent-2">View</summary>
                  <ul className="mt-2 grid gap-1">
                    {stageCount.assessmentIds.map((id) => (
                      <li key={id}>
                        <Link href={`/app/assessments/${id}`} className="ds-focus-ring text-xs text-ds-accent-2 hover:underline">
                          {overview.subjectCodeByAssessmentId[id] ?? id}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-ds-ink">Attention list</p>
        <p className="mt-1 text-xs text-ds-ink-2">
          What today&apos;s stored data actually shows, not a forecast — each card states the exact query behind it.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {overview.signals.map((signal) => (
            <Card key={signal.kind}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ds-ink">{signal.title}</p>
                <span className="text-lg font-semibold text-ds-ink">{signal.items.length}</span>
              </div>
              <p className="mt-1 font-mono text-[11px] text-ds-ink-2">{signal.query}</p>
              {signal.items.length === 0 ? (
                <p className="mt-3 text-sm text-ds-ink-2">Nothing right now.</p>
              ) : (
                <ul className="mt-3 grid gap-2">
                  {signal.items.slice(0, 8).map((item) => (
                    <li key={item.id}>
                      <Link href={item.href} className="ds-focus-ring block text-sm text-ds-accent-2 hover:underline">
                        {item.label}
                      </Link>
                      <p className="text-xs text-ds-ink-2">{item.detail}</p>
                    </li>
                  ))}
                  {signal.items.length > 8 && <li className="text-xs text-ds-ink-2">+{signal.items.length - 8} more</li>}
                </ul>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
