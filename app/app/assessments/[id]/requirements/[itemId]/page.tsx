import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listConfirmedObservations } from "@/lib/observations/generate-supabase";
import { OBSERVATION_KIND_LABELS, sourceSummary } from "@/lib/observations/store";
import { assessmentProgress, ASSESSOR_DECISION_STATEMENT, parseEvidenceDetail, type ItemDecision } from "@/lib/assessment/decision";
import type { ComplianceRating } from "@/lib/rules/constants";
import { RequirementNav, type RequirementNavItem } from "@/components/assessment/requirement-nav";
import { DecisionForm } from "@/components/assessment/decision-form";
import { Pill, type PillTone } from "@/components/ds/pill";
import { EmptyState } from "@/components/ds/empty-state";

function oneOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const OUTCOME_TONE: Record<string, PillTone> = { pass: "ok", fail: "bad", insufficient_data: "warn" };
const OBSERVATION_TONE: Record<string, PillTone> = { evidence_identified: "ok", potential_gap: "warn", requires_attention: "bad" };

/**
 * The screen where the assessment is actually made. Everything the
 * assessor needs to decide one requirement, on one page: the clause, the
 * evidence, the confirmed facts and the rule working behind them, the
 * confirmed observations, their own drafting, and the status.
 *
 * Note what is *not* here: anything that decides for them. Rule results
 * show their arithmetic; observations are narrative; the status control
 * is empty until a person fills it.
 */
export default async function RequirementAssessmentPage({ params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: item } = await supabase
    .from("assessment_items")
    .select(
      "id, assessment_id, requirement_id, compliance_status, remarks, action_required, assessor_observations, office_visit_observations, draft_updated_at, evidence_detail, decided_at, requirements(sl_no, title, is_key, detail_text)",
    )
    .eq("id", itemId)
    .eq("assessment_id", id)
    .maybeSingle();
  if (!item) {
    notFound();
  }

  const requirement = oneOf(item.requirements as unknown as { sl_no: number; title: string; is_key: boolean; detail_text: string | null } | null);
  if (!requirement) {
    notFound();
  }

  const [{ data: assessment }, { data: siblingRows }, { data: linkRows }, { data: evaluationRows }, { data: factRows }, observations, { data: interviewRow }] =
    await Promise.all([
      supabase.from("assessments").select("subject_code, entities(name), facilities(name)").eq("id", id).maybeSingle(),
      supabase
        .from("assessment_items")
        .select("id, compliance_status, remarks, action_required, requirements(sl_no, title, is_key)")
        .eq("assessment_id", id),
      supabase
        .from("evidence_file_requirements")
        .select("evidence_file_id, evidence_files(id, original_name, storage_path, document_class)")
        .eq("requirement_id", item.requirement_id),
      supabase
        .from("rule_evaluations")
        .select("rule_code, rule_version, subject_ref, result, computed_explanation, missing_fact_keys, legal_reference, evaluated_at")
        .eq("assessment_item_id", itemId)
        .order("evaluated_at", { ascending: false }),
      supabase.from("fact_ledger_confirmed").select("fact_key, confirmed_value, unit, page_ref, verbatim_quote").eq("assessment_id", id),
      listConfirmedObservations(supabase, itemId),
      supabase
        .from("interview_insights")
        .select("workers_interviewed_count, nationalities, interpreter_used, notes")
        .eq("assessment_item_id", itemId)
        .maybeSingle(),
    ]);

  const entityName =
    oneOf(assessment?.facilities as unknown as { name: string } | { name: string }[] | null)?.name ??
    oneOf(assessment?.entities as unknown as { name: string } | { name: string }[] | null)?.name ??
    "";

  const navItems: RequirementNavItem[] = (siblingRows ?? [])
    .map((row) => {
      const sibling = oneOf(row.requirements as unknown as { sl_no: number; title: string; is_key: boolean } | null);
      return sibling
        ? {
            assessmentItemId: row.id as string,
            requirementSlNo: sibling.sl_no,
            requirementTitle: sibling.title,
            isKey: sibling.is_key,
            status: (row.compliance_status as ComplianceRating | null) ?? null,
            remarks: (row.remarks as string | null) ?? null,
            actionRequired: (row.action_required as string | null) ?? null,
          }
        : null;
    })
    .filter((entry): entry is RequirementNavItem => entry !== null)
    .sort((a, b) => a.requirementSlNo - b.requirementSlNo);

  const progress = assessmentProgress(navItems as ItemDecision[]);

  // Only the latest evaluation per rule is shown: an assessor is deciding
  // on the current state of the evidence, and the history is in the table.
  const latestEvaluations: typeof evaluationRows = [];
  const seenRules = new Set<string>();
  for (const row of evaluationRows ?? []) {
    const key = `${row.rule_code}:${row.subject_ref ?? ""}`;
    if (seenRules.has(key)) continue;
    seenRules.add(key);
    latestEvaluations.push(row);
  }

  // Facts are narrowed to those the shown rules actually read, so the
  // page states the evidence behind these results rather than every
  // confirmed fact on the assessment.
  const citedFactKeys = new Set((latestEvaluations ?? []).flatMap((row) => (row.missing_fact_keys as string[] | null) ?? []));
  for (const observation of observations) {
    for (const key of observation.sourceFactKeys) citedFactKeys.add(key);
  }
  const facts = (factRows ?? []).filter((row) => citedFactKeys.size === 0 || citedFactKeys.has(row.fact_key as string));

  const evidenceDetail = parseEvidenceDetail(item.evidence_detail);

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <aside>
        <Link href={`/app/assessments/${id}`} className="ds-focus-ring text-xs text-ds-accent-2 underline">
          ← {assessment?.subject_code ?? "Assessment"}
        </Link>
        <p className="mt-2 text-xs text-ds-ink-2">
          {progress.complete} of {progress.total} complete
          {progress.incomplete > 0 && ` · ${progress.incomplete} need detail`}
          {progress.keyOutstanding > 0 && ` · ${progress.keyOutstanding} key outstanding`}
        </p>
        <div className="mt-3">
          <RequirementNav assessmentId={id} items={navItems} currentItemId={itemId} />
        </div>
      </aside>

      <main className="grid gap-6">
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-ds-ink">
              {requirement.sl_no}. {requirement.title}
            </h1>
            {requirement.is_key && (
              <span className="rounded-full border border-ds-accent px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ds-accent-2">
                Key requirement
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ds-ink-2">
            {entityName} · {assessment?.subject_code}
          </p>
          <p className="mt-2 text-xs font-medium text-ds-ink-2">{ASSESSOR_DECISION_STATEMENT}</p>

          <div className="mt-3 rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ds-ink-2">Clause detail</h2>
            <p className="mt-1 text-sm text-ds-ink">
              {requirement.detail_text ?? "The clause text for this requirement has not been supplied by the client yet."}
            </p>
          </div>
        </header>

        <section>
          <h2 className="text-sm font-semibold text-ds-ink">Evidence reviewed</h2>
          {(linkRows ?? []).length === 0 ? (
            <p className="mt-1.5 text-sm text-ds-ink-2">No evidence has been linked to this requirement yet.</p>
          ) : (
            <ul className="mt-1.5 grid gap-1">
              {(linkRows ?? []).map((row) => {
                const file = oneOf(row.evidence_files as unknown as { id: string; original_name: string; document_class: string | null } | null);
                return file ? (
                  <li key={file.id}>
                    <Link
                      href={`/app/assessments/${id}/evidence`}
                      className="ds-focus-ring text-sm text-ds-accent-2 underline"
                    >
                      {file.original_name}
                    </Link>
                    {file.document_class && <span className="ml-2 text-xs text-ds-ink-2">{file.document_class}</span>}
                  </li>
                ) : null;
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ds-ink">Rule results</h2>
          {latestEvaluations.length === 0 ? (
            <p className="mt-1.5 text-sm text-ds-ink-2">No rules have been evaluated for this requirement yet.</p>
          ) : (
            <div className="mt-1.5 grid gap-2">
              {latestEvaluations.map((row) => (
                <div key={`${row.rule_code}-${row.subject_ref ?? ""}`} className="rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={OUTCOME_TONE[row.result as string] ?? "neutral"}>{String(row.result).replace(/_/g, " ")}</Pill>
                    <span className="text-xs font-medium text-ds-ink">{row.rule_code}</span>
                    {row.subject_ref && <span className="text-xs text-ds-ink-2">{row.subject_ref}</span>}
                  </div>
                  {/* The working, shown — this is the whole point of the
                      rule engine computing rather than the model. */}
                  <p className="mt-1 text-sm text-ds-ink">{row.computed_explanation}</p>
                  {row.legal_reference && <p className="mt-1 text-xs text-ds-ink-2">{row.legal_reference}</p>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ds-ink">Confirmed facts</h2>
          {facts.length === 0 ? (
            <p className="mt-1.5 text-sm text-ds-ink-2">No confirmed facts relate to this requirement yet.</p>
          ) : (
            <div className="mt-1.5 overflow-x-auto rounded-ds-control border border-ds-line">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-ds-surface-2 text-xs uppercase tracking-wide text-ds-ink-2">
                    <th className="px-3 py-2">Fact</th>
                    <th className="px-3 py-2">Value</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {facts.map((row) => (
                    <tr key={row.fact_key as string} className="border-t border-ds-line">
                      <td className="px-3 py-2 text-ds-ink">{row.fact_key as string}</td>
                      <td className="px-3 py-2 text-ds-ink">
                        {Array.isArray(row.confirmed_value) ? (row.confirmed_value as string[]).join(", ") : String(row.confirmed_value)}
                        {row.unit ? ` ${row.unit}` : ""}
                      </td>
                      <td className="px-3 py-2 text-xs text-ds-ink-2">
                        {row.page_ref ?? "—"}
                        {row.verbatim_quote ? ` · “${row.verbatim_quote}”` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ds-ink">Confirmed observations</h2>
          {observations.length === 0 ? (
            <div className="mt-1.5">
              <EmptyState title="None confirmed" description="Observations appear here once you confirm them in the evidence workspace." />
            </div>
          ) : (
            <div className="mt-1.5 grid gap-2">
              {observations.map((observation) => (
                <div key={observation.id} className="rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={OBSERVATION_TONE[observation.kind] ?? "neutral"}>{OBSERVATION_KIND_LABELS[observation.kind]}</Pill>
                    {observation.authoredBy === "assessor" && <Pill tone="info">yours</Pill>}
                  </div>
                  <p className="mt-1 text-sm font-medium text-ds-ink">{observation.title}</p>
                  {observation.body && <p className="mt-1 text-xs text-ds-ink-2">{observation.body}</p>}
                  <p className="mt-1 text-xs text-ds-ink-2">Source: {sourceSummary(observation)}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-ds-card border border-ds-line bg-ds-surface-2 p-4">
          <h2 className="text-sm font-semibold text-ds-ink">Specific detail captured</h2>
          <p className="mt-1 text-xs text-ds-ink-2">The figures the report is built from — numbers, not adjectives.</p>
          <dl className="mt-2 grid gap-1 text-xs text-ds-ink-2">
            <div>
              <dt className="inline font-medium text-ds-ink">Salary transfer dates: </dt>
              <dd className="inline">{evidenceDetail.salaryTransferDates.join(", ") || "none recorded"}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-ds-ink">Deduction examples: </dt>
              <dd className="inline">
                {evidenceDetail.deductionExamples.length > 0
                  ? evidenceDetail.deductionExamples
                      .map((entry) => `${entry.type}${entry.amountAed !== null ? ` (AED ${entry.amountAed})` : ""}`)
                      .join(", ")
                  : "none recorded"}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-ds-ink">Sample sizes: </dt>
              <dd className="inline">
                {evidenceDetail.sampleSizes.length > 0
                  ? evidenceDetail.sampleSizes.map((entry) => `${entry.label} ${entry.sampled} of ${entry.population}`).join(", ")
                  : "none recorded"}
              </dd>
            </div>
          </dl>
        </section>

        <DecisionForm
          assessmentId={id}
          assessmentItemId={itemId}
          requirementSlNo={requirement.sl_no}
          requirementTitle={requirement.title}
          initial={{
            status: (item.compliance_status as ComplianceRating | null) ?? null,
            remarks: (item.remarks as string | null) ?? "",
            actionRequired: (item.action_required as string | null) ?? "",
            assessorObservations: (item.assessor_observations as string | null) ?? "",
            officeVisitObservations: (item.office_visit_observations as string | null) ?? "",
            draftUpdatedAt: (item.draft_updated_at as string | null) ?? null,
          }}
          interview={{
            workersInterviewedCount: (interviewRow?.workers_interviewed_count as number | null) ?? null,
            nationalities: (interviewRow?.nationalities as string[] | null) ?? [],
            interpreterUsed: (interviewRow?.interpreter_used as boolean | null) ?? null,
            notes: (interviewRow?.notes as string | null) ?? "",
          }}
        />
      </main>
    </div>
  );
}
