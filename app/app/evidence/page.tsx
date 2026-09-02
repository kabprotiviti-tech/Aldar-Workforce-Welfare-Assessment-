import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from "@/components/ds/table";
import { Pill } from "@/components/ds/pill";
import { EmptyState } from "@/components/ds/empty-state";

interface RfiRequestRow {
  id: string;
  due_date: string;
  status: string;
  issued_at: string;
  assessments: { subject_code: string; entities: { name: string } | { name: string }[] | null } | { subject_code: string; entities: { name: string } | { name: string }[] | null }[] | null;
  rfi_checklist_items: { status: string }[] | null;
}

function oneOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Intake dashboard (this prompt): documents received vs. requested,
 * completeness percentage, overdue requests, across every RFI in the
 * system.
 */
export default async function EvidenceCentrePage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("rfi_requests")
    .select("id, due_date, status, issued_at, assessments(subject_code, entities(name)), rfi_checklist_items(status)")
    .is("deleted_at", null)
    .order("issued_at", { ascending: false });

  const rows = (data ?? []) as RfiRequestRow[];
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <h1 className="text-lg font-semibold text-ds-ink">Evidence Centre</h1>
      <p className="mt-1 text-sm text-ds-ink-2">Documents received vs. requested, across every open RFI.</p>

      <div className="mt-6">
        {rows.length === 0 ? (
          <EmptyState title="No RFIs issued yet" description="Issue one from an assessment's detail page." />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Subject code</TableHeaderCell>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell numeric>Received</TableHeaderCell>
                <TableHeaderCell numeric>Completeness</TableHeaderCell>
                <TableHeaderCell>Due</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((rfi) => {
                const assessment = oneOf(rfi.assessments);
                const entity = oneOf(assessment?.entities ?? null);
                const items = rfi.rfi_checklist_items ?? [];
                const received = items.filter((item) => item.status === "received").length;
                const completeness = items.length === 0 ? 0 : Math.round((received / items.length) * 100);
                const isOverdue = rfi.status === "open" && rfi.due_date < todayIso;
                return (
                  <TableRow key={rfi.id}>
                    <TableCell>
                      <Link href={`/app/evidence/${rfi.id}`} className="ds-focus-ring font-medium text-ds-accent-2 hover:underline">
                        {assessment?.subject_code ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell>{entity?.name ?? "—"}</TableCell>
                    <TableCell numeric>
                      {received} / {items.length}
                    </TableCell>
                    <TableCell numeric>{completeness}%</TableCell>
                    <TableCell>
                      <span className={isOverdue ? "text-ds-bad" : undefined}>{rfi.due_date}</span>
                    </TableCell>
                    <TableCell>
                      <Pill tone={rfi.status === "completed" ? "ok" : isOverdue ? "bad" : "info"}>
                        {isOverdue ? "Overdue" : rfi.status}
                      </Pill>
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
}
