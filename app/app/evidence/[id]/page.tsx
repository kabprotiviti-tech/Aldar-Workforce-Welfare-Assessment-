import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NdaGate } from "@/components/app/nda-gate";
import { Card } from "@/components/ds/card";
import { Pill } from "@/components/ds/pill";
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from "@/components/ds/table";

function oneOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default async function RfiIntakeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: rfi } = await supabase
    .from("rfi_requests")
    .select(
      "id, due_date, status, issued_at, assessments(subject_code, entities(id, name, nda_required, nda_confirmed_at))",
    )
    .eq("id", id)
    .maybeSingle();

  if (!rfi) {
    notFound();
  }

  interface EntityShape {
    id: string;
    name: string;
    nda_required: boolean;
    nda_confirmed_at: string | null;
  }
  interface AssessmentShape {
    subject_code: string;
    entities: EntityShape | EntityShape[] | null;
  }

  const assessment = oneOf(rfi.assessments as unknown as AssessmentShape | AssessmentShape[] | null);
  const entity = oneOf(assessment?.entities ?? null);

  const { data: items } = await supabase
    .from("rfi_checklist_items")
    .select("id, name, status, evidence_files(id, original_name, uploaded_at, virus_scan_status)")
    .eq("rfi_request_id", id)
    .order("name");

  return (
    <div className="grid gap-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-ds-ink">{assessment?.subject_code}</h1>
          <Pill tone={rfi.status === "completed" ? "ok" : "info"}>{rfi.status}</Pill>
        </div>
        <p className="mt-1 text-sm text-ds-ink-2">
          {entity?.name} &middot; due {rfi.due_date}
        </p>
      </div>

      {entity && (
        <NdaGate entityId={entity.id} ndaRequired={entity.nda_required} ndaConfirmedAt={entity.nda_confirmed_at} returnTo={`/app/evidence/${id}`}>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Document</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Uploaded file</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(items ?? []).map((item) => {
                const files = (item.evidence_files ?? []) as { id: string; original_name: string; virus_scan_status: string }[];
                return (
                  <TableRow key={item.id}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>
                      <Pill tone={item.status === "received" ? "ok" : "neutral"}>{item.status}</Pill>
                    </TableCell>
                    <TableCell>
                      {files.length === 0
                        ? "—"
                        : files.map((file) => (
                            <span key={file.id} className="mr-2">
                              {file.original_name}
                              {file.virus_scan_status !== "clean" && (
                                <Pill tone="warn" className="ml-1">
                                  {file.virus_scan_status}
                                </Pill>
                              )}
                            </span>
                          ))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </NdaGate>
      )}

      <Card className="max-w-lg">
        <p className="text-sm text-ds-ink-2">
          The portal link sent to the entity contact isn&apos;t retrievable here — only its hash is stored. Issue a new RFI
          from the assessment if it needs to be resent.
        </p>
      </Card>
    </div>
  );
}
