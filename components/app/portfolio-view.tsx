import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listPortfolio } from "@/lib/scheduling/portfolio";
import type { DbModule } from "@/lib/db/common";
import type { AssessmentStage } from "@/lib/db/assessments";
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from "@/components/ds/table";
import { Pill } from "@/components/ds/pill";
import { EmptyState } from "@/components/ds/empty-state";

const STAGES: AssessmentStage[] = ["plan", "request", "collect", "review", "assess", "report", "act", "monitor"];

export interface PortfolioViewProps {
  module: DbModule;
  title: string;
  description: string;
  searchParams: { stage?: string; owner?: string; overdue?: string };
}

/**
 * Shared portfolio view for the three Assessment Programmes pages —
 * filter by stage, owner, overdue (this prompt). A plain GET form so the
 * filters work with no client JS, matching how every other read-only page
 * in app/app is a Server Component.
 */
export async function PortfolioView({ module, title, description, searchParams }: PortfolioViewProps) {
  const supabase = await createSupabaseServerClient();
  const { data: owners } = await supabase
    .from("users")
    .select("id, full_name")
    .in("role", ["admin", "assessor"])
    .eq("active", true)
    .order("full_name");

  const stage = STAGES.includes(searchParams.stage as AssessmentStage) ? (searchParams.stage as AssessmentStage) : undefined;
  const overdueOnly = searchParams.overdue === "1";
  const ownerId = searchParams.owner || undefined;
  const hasFilters = Boolean(stage || ownerId || overdueOnly);

  const rows = await listPortfolio(supabase, { module, stage, ownerId, overdueOnly });

  return (
    <div>
      <h1 className="text-lg font-semibold text-ds-ink">{title}</h1>
      <p className="mt-1 text-sm text-ds-ink-2">{description}</p>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="stage" className="block text-xs font-medium text-ds-ink-2">
            Stage
          </label>
          <select
            id="stage"
            name="stage"
            defaultValue={stage ?? ""}
            className="ds-focus-ring mt-1 rounded-ds-control border border-ds-line bg-ds-surface px-3 py-1.5 text-sm text-ds-ink"
          >
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="owner" className="block text-xs font-medium text-ds-ink-2">
            Owner
          </label>
          <select
            id="owner"
            name="owner"
            defaultValue={ownerId ?? ""}
            className="ds-focus-ring mt-1 rounded-ds-control border border-ds-line bg-ds-surface px-3 py-1.5 text-sm text-ds-ink"
          >
            <option value="">All owners</option>
            <option value="unassigned">Unassigned</option>
            {(owners ?? []).map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.full_name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-ds-ink">
          <input type="checkbox" name="overdue" value="1" defaultChecked={overdueOnly} className="ds-focus-ring" />
          Overdue only
        </label>
        <button
          type="submit"
          className="ds-focus-ring rounded-ds-control bg-ds-accent px-3.5 py-1.5 text-sm font-medium text-white hover:bg-ds-accent-2"
        >
          Apply filters
        </button>
        {hasFilters && (
          <Link href="?" className="ds-focus-ring text-sm text-ds-ink-2 hover:text-ds-ink hover:underline">
            Clear
          </Link>
        )}
      </form>

      <div className="mt-6">
        {rows.length === 0 ? (
          <EmptyState title="Nothing matches" description="Try clearing the filters, or generate this cycle's assessment set." />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Subject code</TableHeaderCell>
                <TableHeaderCell>Entity / facility</TableHeaderCell>
                <TableHeaderCell>Stage</TableHeaderCell>
                <TableHeaderCell>Owner</TableHeaderCell>
                <TableHeaderCell>Report due</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link href={`/app/assessments/${row.id}`} className="ds-focus-ring font-medium text-ds-accent-2 hover:underline">
                      {row.subjectCode}
                    </Link>
                  </TableCell>
                  <TableCell>{row.facilityName ?? row.entityName}</TableCell>
                  <TableCell>{row.stage}</TableCell>
                  <TableCell>{row.ownerName ?? "—"}</TableCell>
                  <TableCell>
                    {row.reportDueDate ? (
                      <span className={row.isOverdue ? "text-ds-bad" : undefined}>{row.reportDueDate}</span>
                    ) : (
                      "—"
                    )}
                    {row.isOverdue && (
                      <Pill tone="bad" className="ml-2">
                        Overdue
                      </Pill>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
