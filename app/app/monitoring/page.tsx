import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  loadActionAgeingBuckets,
  loadComplianceByRequirementAcrossCycles,
  loadRepeatFindingsByRequirementAndEntity,
} from "@/lib/dashboard/monitoring-supabase";
import type { DbModule } from "@/lib/db/common";
import { Card } from "@/components/ds/card";
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from "@/components/ds/table";
import { EmptyState } from "@/components/ds/empty-state";

const MODULES: { value: DbModule; label: string }[] = [
  { value: "employment_practices", label: "Employment Practices" },
  { value: "onboarding", label: "Onboarding" },
  { value: "accommodation", label: "Accommodation" },
];

export default async function MonitoringPage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const { module: requestedModule } = await searchParams;
  const selectedModule = MODULES.find((m) => m.value === requestedModule)?.value ?? "employment_practices";
  const supabase = await createSupabaseServerClient();

  const [trends, repeatGroups, ageingBuckets] = await Promise.all([
    loadComplianceByRequirementAcrossCycles(supabase, selectedModule),
    loadRepeatFindingsByRequirementAndEntity(supabase),
    loadActionAgeingBuckets(supabase),
  ]);

  const cycleYears = Array.from(new Set(trends.flatMap((t) => t.byCycleYear.map((c) => c.cycleYear)))).sort((a, b) => a - b);

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-lg font-semibold text-ds-ink">Monitoring</h1>
        <p className="mt-1 text-sm text-ds-ink-2">Compliance trends, recurring gaps, and how long actions stay open — across every cycle, not just the current one.</p>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-ds-ink">Compliance by requirement, across cycles</p>
          <form method="get" className="flex items-center gap-2">
            <select
              name="module"
              defaultValue={selectedModule}
              className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-2.5 py-1.5 text-sm text-ds-ink"
            >
              {MODULES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </form>
        </div>
        <div className="mt-3">
          {trends.length === 0 || cycleYears.length === 0 ? (
            <EmptyState title="No assessed cycles yet for this module" />
          ) : (
            <div className="overflow-x-auto rounded-ds-control border border-ds-line">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-ds-surface-2 text-xs uppercase tracking-wide text-ds-ink-2">
                    <th className="px-3 py-2">Requirement</th>
                    {cycleYears.map((year) => (
                      <th key={year} className="px-3 py-2">
                        {year}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trends.map((trend) => (
                    <tr key={trend.requirementSlNo} className="border-t border-ds-line">
                      <td className="px-3 py-2 text-ds-ink">
                        {trend.requirementSlNo}. {trend.requirementTitle}
                      </td>
                      {cycleYears.map((year) => {
                        const counts = trend.byCycleYear.find((c) => c.cycleYear === year);
                        return (
                          <td key={year} className="px-3 py-2 text-xs text-ds-ink-2">
                            {counts ? `C:${counts.compliant} P:${counts.partial} NC:${counts.notCompliant} NA:${counts.notApplicable}` : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-ds-ink">Repeat findings by requirement and entity</p>
        <p className="mt-1 text-xs text-ds-ink-2">query: findings where status &ne; &apos;closed&apos; and repeat_of_finding_id is not null, grouped by requirement + entity</p>
        <div className="mt-3">
          {repeatGroups.length === 0 ? (
            <EmptyState title="No repeat findings open right now" />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Requirement</TableHeaderCell>
                  <TableHeaderCell>Entity</TableHeaderCell>
                  <TableHeaderCell numeric>Repeats</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {repeatGroups.map((group) => (
                  <TableRow key={`${group.requirementSlNo}:${group.entityId}`}>
                    <TableCell>
                      {group.requirementSlNo}. {group.requirementTitle}
                    </TableCell>
                    <TableCell>{group.entityName}</TableCell>
                    <TableCell numeric>
                      <Link href={`/app/findings?open=${group.findingIds[0]}`} className="ds-focus-ring text-ds-accent-2 hover:underline">
                        {group.repeatCount}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-ds-ink">Action ageing</p>
        <p className="mt-1 text-xs text-ds-ink-2">query: findings where status &ne; &apos;closed&apos;, bucketed by days since raised</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ageingBuckets.map((bucket) => (
            <Card key={bucket.bucket}>
              <p className="text-2xl font-semibold text-ds-ink">{bucket.count}</p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-ds-ink-2">{bucket.bucket} days</p>
              {bucket.count > 0 && (
                <details className="mt-2">
                  <summary className="ds-focus-ring cursor-pointer text-xs text-ds-accent-2">View</summary>
                  <ul className="mt-2 grid gap-1">
                    {bucket.items.map((item) => (
                      <li key={item.id}>
                        <Link href={`/app/findings?open=${item.id}`} className="ds-focus-ring text-xs text-ds-accent-2 hover:underline">
                          {item.label}
                        </Link>
                        <p className="text-[11px] text-ds-ink-2">{item.detail}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
