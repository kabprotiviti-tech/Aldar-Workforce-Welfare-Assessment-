import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { closeCycle, generateAssessmentSetForCycle } from "@/lib/cycles/actions";
import { assignAssessmentOwnerFromCycle } from "@/lib/assessments/actions";
import type { DbModule } from "@/lib/db/common";
import { Card } from "@/components/ds/card";
import { Button } from "@/components/ds/button";
import { Pill } from "@/components/ds/pill";
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from "@/components/ds/table";
import { EmptyState } from "@/components/ds/empty-state";
import { StatusBanner } from "@/components/app/status-banner";

const MODULES: { value: DbModule; label: string }[] = [
  { value: "employment_practices", label: "Employment Practices" },
  { value: "onboarding", label: "Onboarding" },
  { value: "accommodation", label: "Accommodation" },
];

export default async function CycleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const { error, success } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const [{ data: cycle }, { data: assessments }, { data: owners }] = await Promise.all([
    supabase.from("cycles").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase
      .from("assessments")
      .select("id, module, subject_code, stage, owner_id, entities(name), facilities(name)")
      .eq("cycle_id", id)
      .is("deleted_at", null)
      .order("subject_code"),
    supabase.from("users").select("id, full_name").in("role", ["admin", "assessor"]).eq("active", true).order("full_name"),
  ]);

  if (!cycle) {
    notFound();
  }

  return (
    <div className="grid gap-8">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ds-ink">{cycle.name}</h1>
          <p className="mt-1 text-sm text-ds-ink-2">{cycle.year}</p>
        </div>
        <Pill tone={cycle.closed_at ? "neutral" : "ok"}>{cycle.closed_at ? "Closed" : "Open"}</Pill>
        {!cycle.closed_at && (
          <form action={closeCycle.bind(null, cycle.id)} className="ml-auto">
            <Button type="submit" variant="secondary">
              Close cycle
            </Button>
          </form>
        )}
      </div>

      <StatusBanner error={error} success={success} />

      {MODULES.map(({ value: module, label }) => {
        const moduleAssessments = (assessments ?? []).filter((a) => a.module === module);
        return (
          <div key={module}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-ds-ink">{label}</p>
              <form action={generateAssessmentSetForCycle.bind(null, cycle.id, cycle.year, module)}>
                <Button type="submit" variant="secondary">
                  Generate assessment set
                </Button>
              </form>
            </div>

            <div className="mt-3">
              {moduleAssessments.length === 0 ? (
                <EmptyState title="No assessments yet for this module" />
              ) : (
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Subject code</TableHeaderCell>
                      <TableHeaderCell>Entity / facility</TableHeaderCell>
                      <TableHeaderCell>Stage</TableHeaderCell>
                      <TableHeaderCell>Owner</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {moduleAssessments.map((assessment) => {
                      const entityName = (assessment.entities as unknown as { name: string } | null)?.name;
                      const facilityName = (assessment.facilities as unknown as { name: string } | null)?.name;
                      return (
                        <TableRow key={assessment.id}>
                          <TableCell>
                            <Link
                              href={`/app/assessments/${assessment.id}`}
                              className="ds-focus-ring font-medium text-ds-accent-2 hover:underline"
                            >
                              {assessment.subject_code}
                            </Link>
                          </TableCell>
                          <TableCell>{facilityName ?? entityName ?? "—"}</TableCell>
                          <TableCell>{assessment.stage}</TableCell>
                          <TableCell>
                            <form
                              action={assignAssessmentOwnerFromCycle.bind(null, assessment.id, cycle.id)}
                              className="flex items-center gap-2"
                            >
                              <select
                                name="owner_id"
                                defaultValue={assessment.owner_id ?? ""}
                                className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-sm text-ds-ink"
                              >
                                <option value="">Unassigned</option>
                                {(owners ?? []).map((owner) => (
                                  <option key={owner.id} value={owner.id}>
                                    {owner.full_name}
                                  </option>
                                ))}
                              </select>
                              <button type="submit" className="ds-focus-ring text-sm text-ds-accent-2 hover:underline">
                                Save
                              </button>
                            </form>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
