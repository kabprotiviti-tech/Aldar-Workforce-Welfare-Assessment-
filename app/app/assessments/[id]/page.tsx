import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assignAssessmentOwner, recordActualVisitDate, updateVisitSchedule, uploadAccessLetter } from "@/lib/assessments/actions";
import { issueRfiAction } from "@/lib/rfi/actions";
import { Card } from "@/components/ds/card";
import { Field } from "@/components/ds/field";
import { Button } from "@/components/ds/button";
import { Pill } from "@/components/ds/pill";
import { Stat } from "@/components/ds/stat";
import { EmptyState } from "@/components/ds/empty-state";
import { StatusBanner } from "@/components/app/status-banner";

export default async function AssessmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const { error, success } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const [{ data: assessment }, { data: owners }, { data: accessLetters }] = await Promise.all([
    supabase.from("assessments").select("*, entities(name), facilities(name)").eq("id", id).maybeSingle(),
    supabase.from("users").select("id, full_name").in("role", ["admin", "assessor"]).eq("active", true).order("full_name"),
    supabase
      .from("evidence_files")
      .select("id, original_name, uploaded_at")
      .eq("assessment_id", id)
      .eq("document_class", "access_letter")
      .order("uploaded_at", { ascending: false }),
  ]);

  if (!assessment) {
    notFound();
  }

  const entityName = (assessment.entities as { name: string } | null)?.name;
  const facilityName = (assessment.facilities as { name: string } | null)?.name;

  const [{ data: contacts }, { data: rfiRequests }] = await Promise.all([
    supabase.from("entity_contacts").select("id, name, email").eq("entity_id", assessment.entity_id).is("deleted_at", null),
    supabase
      .from("rfi_requests")
      .select("id, status, due_date, issued_at, rfi_checklist_items(status)")
      .eq("assessment_id", id)
      .is("deleted_at", null)
      .order("issued_at", { ascending: false }),
  ]);

  return (
    <div className="grid gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-ds-ink">{assessment.subject_code}</h1>
            <Pill tone="info">{assessment.stage}</Pill>
          </div>
          <p className="mt-1 text-sm text-ds-ink-2">{facilityName ?? entityName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/app/assessments/${id}/evidence`}
            className="ds-focus-ring inline-flex items-center justify-center gap-2 rounded-ds-control border border-ds-line bg-ds-surface px-3.5 py-2 text-sm font-medium text-ds-ink hover:border-ds-accent"
          >
            Evidence library
          </Link>
          <Link
            href={`/app/assessments/${id}/photos`}
            className="ds-focus-ring inline-flex items-center justify-center gap-2 rounded-ds-control border border-ds-line bg-ds-surface px-3.5 py-2 text-sm font-medium text-ds-ink hover:border-ds-accent"
          >
            Photograph review
          </Link>
          <Link
            href={`/app/assessments/${id}/inspection`}
            className="ds-focus-ring inline-flex items-center justify-center gap-2 rounded-ds-control border border-ds-line bg-ds-surface px-3.5 py-2 text-sm font-medium text-ds-ink hover:border-ds-accent"
          >
            On-site inspection
          </Link>
        </div>
      </div>

      <StatusBanner error={error} success={success} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <Stat label="Audit number" value={String(assessment.audit_number)} />
        </Card>
        <Card>
          <Stat label="Report due" value={assessment.report_due_date ?? "Not yet computed"} />
        </Card>
        <Card>
          <Stat label="Permission required" value={assessment.permission_required ? "Yes" : "No"} />
        </Card>
      </div>

      <Card className="max-w-lg">
        <p className="text-sm font-medium text-ds-ink">Owner</p>
        <form action={assignAssessmentOwner.bind(null, assessment.id)} className="mt-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-ds-ink" htmlFor="owner_id">
              Assigned to
            </label>
            <select
              id="owner_id"
              name="owner_id"
              defaultValue={assessment.owner_id ?? ""}
              className="ds-focus-ring mt-1.5 w-full rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2 text-sm text-ds-ink"
            >
              <option value="">Unassigned</option>
              {(owners ?? []).map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.full_name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="secondary">
            Save
          </Button>
        </form>
      </Card>

      <Card className="max-w-lg">
        <p className="text-sm font-medium text-ds-ink">Visit schedule</p>
        <form action={updateVisitSchedule.bind(null, assessment.id)} className="mt-4 grid gap-4">
          <Field
            label="Proposed visit date"
            name="proposed_visit_date"
            type="date"
            defaultValue={assessment.proposed_visit_date ?? ""}
          />
          <Field
            label="Confirmed visit date"
            name="confirmed_visit_date"
            type="date"
            defaultValue={assessment.confirmed_visit_date ?? ""}
          />
          <label className="flex items-center gap-2 text-sm text-ds-ink">
            <input
              type="checkbox"
              name="permission_required"
              defaultChecked={assessment.permission_required}
              className="ds-focus-ring"
            />
            Requires access permission to visit
          </label>
          <Button type="submit" variant="secondary" className="justify-self-start">
            Save schedule
          </Button>
        </form>
      </Card>

      <Card className="max-w-lg">
        <p className="text-sm font-medium text-ds-ink">Actual visit date</p>
        <p className="mt-1 text-xs text-ds-ink-2">
          Report due date is computed and stored once, from this date plus 10 UAE working days.
        </p>
        <form action={recordActualVisitDate.bind(null, assessment.id)} className="mt-4 grid gap-4">
          <Field label="Actual visit date" name="actual_visit_date" type="date" defaultValue={assessment.actual_visit_date ?? ""} required />
          <Button type="submit" variant="secondary" className="justify-self-start">
            Record visit date
          </Button>
        </form>
      </Card>

      <div>
        <p className="text-sm font-medium text-ds-ink">Requests for information</p>
        <div className="mt-4 grid gap-6 lg:grid-cols-[2fr_1fr]">
          {!rfiRequests || rfiRequests.length === 0 ? (
            <EmptyState title="No RFIs issued yet" />
          ) : (
            <div className="grid gap-3">
              {rfiRequests.map((rfi) => {
                const items = (rfi.rfi_checklist_items ?? []) as { status: string }[];
                const received = items.filter((item) => item.status === "received").length;
                return (
                  <Card key={rfi.id}>
                    <div className="flex items-center justify-between">
                      <Link href={`/app/evidence/${rfi.id}`} className="ds-focus-ring font-medium text-ds-accent-2 hover:underline">
                        Issued {new Date(rfi.issued_at).toLocaleDateString()}
                      </Link>
                      <Pill tone={rfi.status === "completed" ? "ok" : "info"}>{rfi.status}</Pill>
                    </div>
                    <p className="mt-1 text-sm text-ds-ink-2">
                      {received} of {items.length} received &middot; due {rfi.due_date}
                    </p>
                  </Card>
                );
              })}
            </div>
          )}

          <Card>
            <p className="text-sm font-medium text-ds-ink">Issue an RFI</p>
            {!contacts || contacts.length === 0 ? (
              <p className="mt-3 text-sm text-ds-ink-2">This entity has no contacts on file yet.</p>
            ) : (
              <form action={issueRfiAction.bind(null, assessment.id)} className="mt-4 grid gap-3">
                <div>
                  <label className="block text-sm font-medium text-ds-ink" htmlFor="contact_id">
                    Send to
                  </label>
                  <select
                    id="contact_id"
                    name="contact_id"
                    required
                    className="ds-focus-ring mt-1.5 w-full rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2 text-sm text-ds-ink"
                  >
                    {contacts.map((contact) => (
                      <option key={contact.id} value={contact.id} disabled={!contact.email}>
                        {contact.name} {contact.email ? `(${contact.email})` : "— no email"}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-ds-ink-2">
                  Generates a document checklist from this module&apos;s RFI templates, due 14 days from today.
                </p>
                <Button type="submit" variant="secondary" className="justify-self-start">
                  Issue RFI
                </Button>
              </form>
            )}
          </Card>
        </div>
      </div>

      {assessment.permission_required && (
        <Card className="max-w-lg">
          <p className="text-sm font-medium text-ds-ink">Access letter</p>
          <p className="mt-1 text-xs text-ds-ink-2">
            The client&apos;s supporting letter confirming permission to visit this facility.
          </p>
          {accessLetters && accessLetters.length > 0 && (
            <ul className="mt-3 grid gap-1.5 text-sm text-ds-ink-2">
              {accessLetters.map((file) => (
                <li key={file.id}>{file.original_name}</li>
              ))}
            </ul>
          )}
          <form action={uploadAccessLetter.bind(null, assessment.id)} className="mt-4 grid gap-3">
            <input type="file" name="file" required className="ds-focus-ring text-sm text-ds-ink" />
            <Button type="submit" variant="secondary" className="justify-self-start">
              Upload
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
