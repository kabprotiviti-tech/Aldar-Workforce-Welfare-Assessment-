"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveAssessment,
  openAssessmentRevision,
  openQaReview,
  passQaReview,
  raiseQaQuery,
  resolveQaQuery,
  returnToAssessor,
} from "@/lib/qa/actions";
import type { QaCheckResult } from "@/lib/qa/checklist";
import type { ApprovalStatus, QaStatus } from "@/lib/db/assessments";
import { Button } from "@/components/ds/button";
import { Textarea } from "@/components/ds/textarea";
import { Pill, type PillTone } from "@/components/ds/pill";
import { Card } from "@/components/ds/card";

const QA_STATUS_LABEL: Record<QaStatus, string> = { not_started: "Not started", in_review: "In review", returned: "Returned to assessor", passed: "Passed" };
const QA_STATUS_TONE: Record<QaStatus, PillTone> = { not_started: "neutral", in_review: "info", returned: "warn", passed: "ok" };
const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = { pending: "Pending", awaiting_client: "Awaiting client approval", approved: "Approved" };
const APPROVAL_STATUS_TONE: Record<ApprovalStatus, PillTone> = { pending: "neutral", awaiting_client: "info", approved: "ok" };

export interface QaQueryView {
  id: string;
  itemId: string;
  itemLabel: string;
  queryText: string;
  status: "open" | "resolved";
  resolutionNote: string | null;
  raisedAt: string;
}

export interface QaItemOption {
  id: string;
  slNo: number;
  title: string;
}

export function QaGovernancePanel({
  assessmentId,
  qaStatus,
  approvalStatus,
  revisionNumber,
  checklist,
  queries,
  items,
  canQaReview,
  canApprove,
}: {
  assessmentId: string;
  qaStatus: QaStatus;
  approvalStatus: ApprovalStatus;
  revisionNumber: number;
  checklist: QaCheckResult[];
  queries: QaQueryView[];
  items: QaItemOption[];
  canQaReview: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [queryItemId, setQueryItemId] = useState(items[0]?.id ?? "");
  const [queryText, setQueryText] = useState("");
  const [revisionReason, setRevisionReason] = useState("");

  const openQueries = queries.filter((q) => q.status === "open");
  const checklistPasses = checklist.every((c) => c.passed);

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message ?? "Something went wrong.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-medium text-ds-ink">QA &amp; approval</p>
        <Pill tone={QA_STATUS_TONE[qaStatus]}>QA: {QA_STATUS_LABEL[qaStatus]}</Pill>
        <Pill tone={APPROVAL_STATUS_TONE[approvalStatus]}>{APPROVAL_STATUS_LABEL[approvalStatus]}</Pill>
        <span className="text-xs text-ds-ink-2">Version {revisionNumber}</span>
      </div>

      <Card>
        <p className="text-sm font-medium text-ds-ink">Automated QA checklist</p>
        <ul className="mt-3 grid gap-2">
          {checklist.map((check) => (
            <li key={check.id} className="flex items-start gap-2 text-sm">
              <Pill tone={check.passed ? "ok" : "bad"}>{check.passed ? "Pass" : "Fail"}</Pill>
              <div>
                <p className="text-ds-ink">{check.label}</p>
                {!check.passed && <p className="text-xs text-ds-ink-2">{check.detail}</p>}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {canQaReview && (
        <Card>
          <p className="text-sm font-medium text-ds-ink">QA reviewer actions</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(qaStatus === "not_started" || qaStatus === "returned") && (
              <Button variant="secondary" disabled={pending} onClick={() => run(() => openQaReview(assessmentId))}>
                Open review
              </Button>
            )}
            {qaStatus === "in_review" && (
              <>
                <Button variant="secondary" disabled={pending || openQueries.length === 0} onClick={() => run(() => returnToAssessor(assessmentId))}>
                  Return to assessor
                </Button>
                <Button disabled={pending || openQueries.length > 0 || !checklistPasses} onClick={() => run(() => passQaReview(assessmentId))}>
                  Pass QA
                </Button>
              </>
            )}
          </div>

          {qaStatus === "in_review" && items.length > 0 && (
            <div className="mt-4 grid gap-2 border-t border-ds-line pt-4">
              <p className="text-sm font-medium text-ds-ink">Raise a query</p>
              <select
                value={queryItemId}
                onChange={(e) => setQueryItemId(e.target.value)}
                className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2 text-sm text-ds-ink"
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.slNo}. {item.title}
                  </option>
                ))}
              </select>
              <Textarea label="Query" value={queryText} onChange={(e) => setQueryText(e.target.value)} rows={2} />
              <Button
                variant="secondary"
                className="justify-self-start"
                disabled={pending || !queryText.trim() || !queryItemId}
                onClick={() =>
                  run(async () => {
                    const result = await raiseQaQuery(assessmentId, queryItemId, queryText);
                    if (result.ok) setQueryText("");
                    return result;
                  })
                }
              >
                Raise query
              </Button>
            </div>
          )}
        </Card>
      )}

      {queries.length > 0 && (
        <Card>
          <p className="text-sm font-medium text-ds-ink">Queries</p>
          <ul className="mt-3 grid gap-3">
            {queries.map((query) => (
              <QueryRow key={query.id} query={query} assessmentId={assessmentId} onResolved={() => router.refresh()} />
            ))}
          </ul>
        </Card>
      )}

      {canApprove && approvalStatus === "awaiting_client" && (
        <Card>
          <p className="text-sm font-medium text-ds-ink">Client approval</p>
          <p className="mt-1 text-xs text-ds-ink-2">Locks the assessment and every item, and generates the report.</p>
          <Button className="mt-3" disabled={pending} onClick={() => run(() => approveAssessment(assessmentId))}>
            Approve
          </Button>
        </Card>
      )}

      {canApprove && approvalStatus === "approved" && (
        <Card>
          <p className="text-sm font-medium text-ds-ink">Formal revision</p>
          <p className="mt-1 text-xs text-ds-ink-2">Reopens this assessment for version {revisionNumber + 1}. Version {revisionNumber}&apos;s report is preserved exactly.</p>
          <Textarea label="Reason" className="mt-3" value={revisionReason} onChange={(e) => setRevisionReason(e.target.value)} rows={2} />
          <Button
            variant="secondary"
            className="mt-2"
            disabled={pending || !revisionReason.trim()}
            onClick={() =>
              run(async () => {
                const result = await openAssessmentRevision(assessmentId, revisionReason);
                if (result.ok) setRevisionReason("");
                return result;
              })
            }
          >
            Open revision
          </Button>
        </Card>
      )}

      {error && <p className="text-sm text-ds-bad">{error}</p>}
    </div>
  );
}

function QueryRow({ query, assessmentId, onResolved }: { query: QaQueryView; assessmentId: string; onResolved: () => void }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="rounded-ds-control border border-ds-line p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ds-ink">{query.itemLabel}</p>
        <Pill tone={query.status === "open" ? "bad" : "ok"}>{query.status}</Pill>
      </div>
      <p className="mt-1 text-sm text-ds-ink">{query.queryText}</p>
      {query.status === "resolved" && query.resolutionNote && <p className="mt-1 text-xs text-ds-ink-2">Resolved: {query.resolutionNote}</p>}
      {query.status === "open" && (
        <div className="mt-2 grid gap-2">
          <Textarea label="Resolution" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          <Button
            variant="secondary"
            className="justify-self-start"
            disabled={pending || !note.trim()}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await resolveQaQuery(query.id, assessmentId, note);
                if (!result.ok) {
                  setError(result.message ?? "Could not resolve this query.");
                  return;
                }
                onResolved();
              });
            }}
          >
            Resolve
          </Button>
          {error && <p className="text-xs text-ds-bad">{error}</p>}
        </div>
      )}
    </li>
  );
}
