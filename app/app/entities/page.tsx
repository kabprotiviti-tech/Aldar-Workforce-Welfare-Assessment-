import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from "@/components/ds/table";
import { Pill } from "@/components/ds/pill";
import { EmptyState } from "@/components/ds/empty-state";
import { StatusBanner } from "@/components/app/status-banner";

export default async function EntitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: entities } = await supabase
    .from("entities")
    .select("id, name, entity_code, type, status, worker_count")
    .is("deleted_at", null)
    .order("name");

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ds-ink">Entities</h1>
          <p className="mt-1 text-sm text-ds-ink-2">The supply-chain companies being assessed.</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/app/entities/import"
            className="ds-focus-ring inline-flex items-center justify-center gap-2 rounded-ds-control border border-ds-line bg-ds-surface px-3.5 py-2 text-sm font-medium text-ds-ink hover:border-ds-accent"
          >
            Import CSV
          </Link>
          <Link
            href="/app/entities/new"
            className="ds-focus-ring inline-flex items-center justify-center gap-2 rounded-ds-control bg-ds-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-ds-accent-2"
          >
            New entity
          </Link>
        </div>
      </div>

      <div className="mt-6">
        <StatusBanner error={error} success={success} />

        {!entities || entities.length === 0 ? (
          <EmptyState
            title="No entities yet"
            description="Add one, or import this cycle's list from the client."
          />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Code</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell numeric>Workers</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entities.map((entity) => (
                <TableRow key={entity.id}>
                  <TableCell>
                    <Link href={`/app/entities/${entity.id}`} className="ds-focus-ring font-medium text-ds-accent-2 hover:underline">
                      {entity.name}
                    </Link>
                  </TableCell>
                  <TableCell>{entity.entity_code}</TableCell>
                  <TableCell>{entity.type.replaceAll("_", " ")}</TableCell>
                  <TableCell>
                    <Pill tone={entity.status === "active" ? "ok" : "neutral"}>{entity.status}</Pill>
                  </TableCell>
                  <TableCell numeric>{entity.worker_count ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
