import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assignAssessmentOwner, recordActualVisitDate, updateVisitSchedule, uploadAccessLetter } from "@/lib/assessments/actions";
import { issueRfiAction } from "@/lib/rfi/actions";
import { buildCycleDiff } from "@/lib/assessment/carry-forward";
import { loadAndRunQaChecklist } from "@/lib/qa/checklist-supabase";
import type { ComplianceRating } from "@/lib/rules/constants";
import { Card } from "@/components/ds/card";
import { Field } from "@/components/ds/field";
import { Button } from "@/components/ds/button";
import { Pill, type PillTone } from "@/components/ds/pill";
import { Stat } from "@/components/ds/stat";
import { EmptyState } from "@/components/ds/empty-state";
import { StatusBanner } from "@/components/app/status-banner";
import { AssessmentTimeline } from "@/components/qa/assessment-timeline";
import { QaGovernancePanel } from "@/components/qa/qa-governance-panel";

const STATUS_TONE: Record<ComplianceRating, PillTone> = {
  Compliant: "ok",
  Partial: "warn",
  "Not Compliant": "bad",
  "Not Applicable": "neutral",
};

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

  const [{ data: contacts }, { data: rfiRequests }, { data: itemRows }, { data: currentReport }] = await Promise.all([
    supabase.from("entity_contacts").select("id, name, email").eq("entity_id", assessment.entity_id).is("deleted_at", null),
    supabase
      .from("rfi_requests")
      .select("id, status, due_date, issued_at, rfi_checklist_items(status)")
      .eq("assessment_id", id)
      .is("deleted_at", null)
      .order("issued_at", { ascending: false }),
    // "A diff view: previous cycle status beside this cycle's status for
    // all items, with changes highlighted" (this prompt).
    supabase
      .from("assessment_items")
      .select("compliance_status, previous_compliance_status, was_assessed, requirements(sl_no, title)")
      .eq("assessment_id", id),
    supabase.from("reports").select("id, version, format, storage_path, generated_at").eq("assessment_id", id).eq("is_current", true).maybeSingle(),
  ]);

  // A signed URL, not a public link — the "reports" bucket has no public
  // read (0031_reports_bucket.sql), the same reasoning as the evidence
  // preview's getEvidencePreviewUrl. Generated fresh on every page render,
  // so a short expiry is fine.
  const reportDownloadUrl = currentReport
    ? (await supabase.storage.from("reports").createSignedUrl(currentReport.storage_path as string, 300)).data?.signedUrl ?? null
    : null;

  const cycleDiff = buildCycleDiff(
    (itemRows ?? [])
      .map((row) => {
        const requirement = (Array.isArray(row.requirements) ? row.requirements[0] : row.requirements) as { sl_no: number; title: string } | null;
        return requirement
          ? {
              requirementSlNo: requirement.sl_no,
              requirementTitle: requirement.title,
              previousStatus: row.previous_compliance_status as ComplianceRating | null,
              currentStatus: row.compliance_status as ComplianceRating | null,
              wasAssessed: row.was_assessed as boolean,
            }
          : null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null),
  );
  const hasPreviousCycle = cycleDiff.some((row) => row.previousStatus !== null);

  const { data: userData } = await supabase.auth.getUser();
  const [{ data: currentUser }, checklist, { data: queryRows }, { data: revisionRows }, { data: itemOptionRows }] = await Promise.all([
    userData.user ? supabase.from("users").select("role").eq("id", userData.user.id).maybeSingle() : Promise.resolve({ data: null }),
    loadAndRunQaChecklist(supabase, id),
    supabase
      .from("qa_queries")
      .select("id, assessment_item_id, query_text, status, resolution_note, raised_at, assessment_items(requirements(sl_no, title))")
      .eq("assessment_id", id)
      .order("raised_at", { ascending: false }),
    supabase.from("assessment_revisions").select("revision_number, reason, revised_at").eq("assessment_id", id).order("revision_number"),
    supabase.from("assessment_items").select("id, requirements(sl_no, title)").eq("assessment_id", id),
  ]);

  const currentRole = (currentUser?.role as string | undefined) ?? null;
  const canQaReview = currentRole === "admin" || currentRole === "qa_reviewer";
  const canApprove = currentRole === "admin";

  const queries = (queryRows ?? []).map((row) => {
    const item = (Array.isArray(row.assessment_items) ? row.assessment_items[0] : row.assessment_items) as { requirements: unknown } | null;
    const requirement = (Array.isArray(item?.requirements) ? item?.requirements[0] : item?.requirements) as { sl_no: number; title: string } | undefined;
    return {
      id: row.id as string,
      itemId: row.assessment_item_id as string,
      itemLabel: requirement ? `${requirement.sl_no}. ${requirement.title}` : "Requirement",
      queryText: row.query_text as string,
      status: row.status as "open" | "resolved",
      resolutionNote: (row.resolution_note as string | null) ?? null,
      raisedAt: row.raised_at as string,
    };
  });

  const itemOptions = (itemOptionRows ?? [])
    .map((row) => {
      const requirement = (Array.isArray(row.requirements) ? row.requirements[0] : row.requirements) as { sl_no: number; title: string } | null;
      return requirement ? { id: row.id as string, slNo: requirement.sl_no, title: requirement.title } : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => a.slNo - b.slNo);

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
          <Link
            href={`/app/assessments/${id}/lineage`}
            className="ds-focus-ring inline-flex items-center justify-center gap-2 rounded-ds-control border border-ds-line bg-ds-surface px-3.5 py-2 text-sm font-medium text-ds-ink hover:border-ds-accent"
          >
            Lineage
          </Link>
        </div>
      </div>

      <StatusBanner error={error} success={success} />

      <AssessmentTimeline
        createdAt={assessment.created_at}
        qaCompletedAt={assessment.qa_completed_at}
        approvedAt={assessment.approved_at}
        issuedAt={assessment.issued_at}
        revisions={(revisionRows ?? []).map((row) => ({ revisionNumber: row.revision_number as number, reason: row.reason as string, revisedAt: row.revised_at as string }))}
      />

      <QaGovernancePanel
        assessmentId={id}
        qaStatus={assessment.qa_status}
        approvalStatus={assessment.approval_status}
        revisionNumber={assessment.revision_number}
        checklist={checklist}
        queries={queries}
        items={itemOptions}
        canQaReview={canQaReview}
        canApprove={canApprove}
      />

      {currentReport && (
        <Card className="max-w-lg">
          <p className="text-sm font-medium text-ds-ink">Report</p>
          <p className="mt-1 text-xs text-ds-ink-2">
            Version {String(currentReport.version)} &middot; generated {new Date(currentReport.generated_at as string).toLocaleDateString()}
          </p>
          {reportDownloadUrl ? (
            <a
              href={reportDownloadUrl}
              className="ds-focus-ring mt-4 inline-flex items-center justify-center gap-2 rounded-ds-control border border-ds-line bg-ds-surface px-3.5 py-2 text-sm font-medium text-ds-ink hover:border-ds-accent"
            >
              Download report ({(currentReport.format as string).toUpperCase()})
            </a>
          ) : (
            <p className="mt-4 text-sm text-ds-ink-2">Could not generate a download link.</p>
          )}
        </Card>
      )}

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

      {hasPreviousCycle && (
        <div>
          <p className="text-sm font-medium text-ds-ink">Cycle diff</p>
          <p className="mt-1 text-xs text-ds-ink-2">Previous cycle status beside this cycle&apos;s, for every requirement. A changed row is highlighted.</p>
          <div className="mt-3 overflow-x-auto rounded-ds-control border border-ds-line">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="bg-ds-surface-2 text-xs uppercase tracking-wide text-ds-ink-2">
                  <th className="px-3 py-2">Requirement</th>
                  <th className="px-3 py-2">Previous cycle</th>
                  <th className="px-3 py-2">This cycle</th>
                  <th className="px-3 py-2">Assessed this cycle?</th>
                </tr>
              </thead>
              <tbody>
                {cycleDiff.map((row) => (
                  <tr key={row.requirementSlNo} className={`border-t border-ds-line ${row.changed ? "bg-ds-accent-soft" : ""}`}>
                    <td className="px-3 py-2 text-ds-ink">
                      {row.requirementSlNo}. {row.requirementTitle}
                    </td>
                    <td className="px-3 py-2">
                      {row.previousStatus ? <Pill tone={STATUS_TONE[row.previousStatus]}>{row.previousStatus}</Pill> : <span className="text-ds-ink-2">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {row.currentStatus ? <Pill tone={STATUS_TONE[row.currentStatus]}>{row.currentStatus}</Pill> : <span className="text-ds-ink-2">Not yet decided</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-ds-ink-2">{row.wasAssessed ? "Yes" : "Carried forward"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
