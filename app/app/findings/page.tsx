import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FindingsExplorer, type EntityContactOption, type FindingEventRow, type FindingRow } from "@/components/findings/findings-explorer";

function oneOf<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/**
 * Findings & Actions (this prompt: finding lifecycle management). One
 * page fetches everything the list, its filters, the detail drawer and
 * the cross-cycle view all need — findings are staff-scoped and few
 * enough in practice that a single query beats round-tripping per
 * filter or per drawer open. Filtering itself happens client-side
 * (components/findings/findings-explorer.tsx), the same shape as the
 * evidence library's three-panel view.
 */
export default async function FindingsPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const { open } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: findings, error } = await supabase
    .from("findings")
    .select(
      `id, title, priority, status, due_date, owner_name, owner_email, owner_organisation, owner_contact_id,
       repeat_of_finding_id, created_at, closed_at, reviewer_decision, reviewer_decision_reason, closure_evidence_text,
       entity_id, facility_id,
       entities(name), facilities(name),
       assessment_items!inner(requirement_id, action_required, requirements(sl_no, title), assessments(module, subject_code))`,
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const findingIds = (findings ?? []).map((f) => f.id as string);

  const [{ data: evidenceRows }, { data: eventRows }, { data: contactRows }] = await Promise.all([
    findingIds.length > 0
      ? supabase
          .from("evidence_files")
          .select("id, finding_id, original_name, storage_path, uploaded_at")
          .in("finding_id", findingIds)
          .order("uploaded_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; finding_id: string | null; original_name: string; storage_path: string; uploaded_at: string }[] }),
    findingIds.length > 0
      ? supabase.from("finding_events").select("finding_id, event_type, note, actor_id, created_at").in("finding_id", findingIds).order("created_at")
      : Promise.resolve({ data: [] as { finding_id: string; event_type: string; note: string | null; actor_id: string | null; created_at: string }[] }),
    supabase.from("entity_contacts").select("id, entity_id, name, email").is("deleted_at", null),
  ]);

  const evidenceByFinding = new Map<string, { id: string; originalName: string; storagePath: string; uploadedAt: string }[]>();
  for (const row of evidenceRows ?? []) {
    if (!row.finding_id) continue;
    const list = evidenceByFinding.get(row.finding_id) ?? [];
    list.push({ id: row.id, originalName: row.original_name, storagePath: row.storage_path, uploadedAt: row.uploaded_at });
    evidenceByFinding.set(row.finding_id, list);
  }

  const rows: FindingRow[] = (findings ?? []).map((f) => {
    const entity = oneOf(f.entities as unknown as { name: string } | { name: string }[] | null);
    const facility = oneOf(f.facilities as unknown as { name: string } | { name: string }[] | null);
    const item = oneOf(
      f.assessment_items as unknown as
        | { requirement_id: string; action_required: string | null; requirements: unknown; assessments: unknown }
        | { requirement_id: string; action_required: string | null; requirements: unknown; assessments: unknown }[]
        | null,
    );
    const requirement = oneOf(item?.requirements as unknown as { sl_no: number; title: string } | { sl_no: number; title: string }[] | null);
    const assessment = oneOf(item?.assessments as unknown as { module: string; subject_code: string } | { module: string; subject_code: string }[] | null);
    const dueDate = (f.due_date as string | null) ?? null;

    return {
      id: f.id as string,
      title: f.title as string,
      priority: f.priority as FindingRow["priority"],
      status: f.status as FindingRow["status"],
      dueDate,
      ownerName: (f.owner_name as string | null) ?? null,
      ownerEmail: (f.owner_email as string | null) ?? null,
      ownerOrganisation: (f.owner_organisation as string | null) ?? null,
      ownerContactId: (f.owner_contact_id as string | null) ?? null,
      repeatOfFindingId: (f.repeat_of_finding_id as string | null) ?? null,
      createdAt: f.created_at as string,
      closedAt: (f.closed_at as string | null) ?? null,
      reviewerDecision: (f.reviewer_decision as string | null) ?? null,
      reviewerDecisionReason: (f.reviewer_decision_reason as string | null) ?? null,
      closureEvidenceText: (f.closure_evidence_text as string | null) ?? null,
      module: (assessment?.module ?? "employment_practices") as FindingRow["module"],
      subjectCode: assessment?.subject_code ?? "",
      entityId: f.entity_id as string,
      entityName: entity?.name ?? "",
      facilityName: facility?.name ?? null,
      requirementId: item?.requirement_id ?? "",
      requirementSlNo: requirement?.sl_no ?? 0,
      requirementTitle: requirement?.title ?? "",
      actionRequired: item?.action_required ?? null,
      evidence: evidenceByFinding.get(f.id as string) ?? [],
      isOverdue: dueDate !== null && dueDate < today && f.status !== "closed",
    };
  });

  const events: FindingEventRow[] = (eventRows ?? []).map((e) => ({
    findingId: e.finding_id,
    eventType: e.event_type,
    note: e.note,
    actorId: e.actor_id,
    createdAt: e.created_at,
  }));

  const contacts: EntityContactOption[] = (contactRows ?? []).map((c) => ({
    id: c.id as string,
    entityId: c.entity_id as string,
    name: c.name as string,
    email: (c.email as string | null) ?? null,
  }));

  return <FindingsExplorer findings={rows} events={events} contacts={contacts} initialOpenId={open ?? null} />;
}
