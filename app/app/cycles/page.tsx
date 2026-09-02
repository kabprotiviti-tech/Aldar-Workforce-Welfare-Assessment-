import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { openCycle } from "@/lib/cycles/actions";
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from "@/components/ds/table";
import { Pill } from "@/components/ds/pill";
import { Card } from "@/components/ds/card";
import { Field } from "@/components/ds/field";
import { Button } from "@/components/ds/button";
import { EmptyState } from "@/components/ds/empty-state";
import { StatusBanner } from "@/components/app/status-banner";

export default async function CyclesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: cycles } = await supabase
    .from("cycles")
    .select("id, year, name, opened_at, closed_at")
    .is("deleted_at", null)
    .order("opened_at", { ascending: false });

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-lg font-semibold text-ds-ink">Cycles</h1>
        <p className="mt-1 text-sm text-ds-ink-2">The assessment periods every assessment belongs to.</p>
      </div>

      <StatusBanner error={error} />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {!cycles || cycles.length === 0 ? (
          <EmptyState title="No cycles yet" description="Open a cycle to start generating assessments." />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell numeric>Year</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {cycles.map((cycle) => (
                <TableRow key={cycle.id}>
                  <TableCell>
                    <Link href={`/app/cycles/${cycle.id}`} className="ds-focus-ring font-medium text-ds-accent-2 hover:underline">
                      {cycle.name}
                    </Link>
                  </TableCell>
                  <TableCell numeric>{cycle.year}</TableCell>
                  <TableCell>
                    <Pill tone={cycle.closed_at ? "neutral" : "ok"}>{cycle.closed_at ? "Closed" : "Open"}</Pill>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Card>
          <p className="text-sm font-medium text-ds-ink">Open a cycle</p>
          <form action={openCycle} className="mt-4 grid gap-3">
            <Field label="Year" name="year" type="number" required defaultValue={new Date().getFullYear()} />
            <Field label="Name" name="name" required placeholder="e.g. 2026 Cycle 1" />
            <Button type="submit" className="justify-self-start">
              Open cycle
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
