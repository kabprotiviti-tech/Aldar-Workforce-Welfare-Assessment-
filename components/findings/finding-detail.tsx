"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignFindingOwner, reopenFinding, reviewFindingClosure, sendClosureRequest } from "@/lib/findings/actions";
import { canRecordReviewDecision, canReopen } from "@/lib/findings/lifecycle";
import { buildFindingHistory, type FindingOutcome } from "@/lib/findings/history";
import type { FindingEventRow, EntityContactOption, FindingRow } from "@/components/findings/findings-explorer";
import { Button } from "@/components/ds/button";
import { Field } from "@/components/ds/field";
import { Textarea } from "@/components/ds/textarea";
import { Pill, type PillTone } from "@/components/ds/pill";

const OUTCOME_TONE: Record<FindingOutcome, PillTone> = { raised: "bad", actioned: "warn", closed: "ok" };

/**
 * The finding detail drawer (this prompt): "supporting evidence, required
 * action, closure evidence, reviewer decision and full timeline," plus
 * the cross-cycle view for this entity+requirement. Every action here
 * calls straight into lib/findings/actions.ts — server actions imported
 * directly into a client component, the same pattern as
 * components/assessment/carry-forward-panel.tsx.
 */
export function FindingDetail({
  finding,
  history,
  events,
  contacts,
}: {
  finding: FindingRow;
  history: FindingRow[];
  events: FindingEventRow[];
  contacts: EntityContactOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [ownerName, setOwnerName] = useState(finding.ownerName ?? "");
  const [ownerEmail, setOwnerEmail] = useState(finding.ownerEmail ?? "");
  const [ownerOrganisation, setOwnerOrganisation] = useState(finding.ownerOrganisation ?? "");
  const [ownerContactId, setOwnerContactId] = useState(finding.ownerContactId ?? "");
  const [rejectReason, setRejectReason] = useState("");
  const [newDueDate, setNewDueDate] = useState("");

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

  const findingHistory = buildFindingHistory(
    history.map((f) => ({ id: f.id, createdAt: f.createdAt, status: f.status, repeatOfFindingId: f.repeatOfFindingId })),
  );

  return (
    <div className="grid gap-6">
      <section>
        <p className="text-xs text-ds-ink-2">
          {finding.subjectCode} &middot; {finding.entityName}
          {finding.facilityName && ` · ${finding.facilityName}`}
        </p>
        <p className="mt-1 text-sm text-ds-ink">{finding.requirementTitle}</p>
        {finding.actionRequired && finding.actionRequired !== "N/A" && (
          <p className="mt-2 rounded-ds-control border-l-4 border-l-ds-warn bg-ds-surface-2 px-2.5 py-1.5 text-sm text-ds-ink">
            <span className="font-medium">Required action: </span>
            {finding.actionRequired}
          </p>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ds-ink">Owner</h3>
        <div className="mt-2 grid gap-2">
          <Field label="Name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} disabled={finding.status === "closed"} />
          <Field label="Email" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} disabled={finding.status === "closed"} />
          <Field
            label="Organisation"
            value={ownerOrganisation}
            onChange={(e) => setOwnerOrganisation(e.target.value)}
            disabled={finding.status === "closed"}
          />
          <label className="text-sm font-medium text-ds-ink">
            Known contact (required to send a closure link)
            <select
              value={ownerContactId}
              onChange={(e) => setOwnerContactId(e.target.value)}
              disabled={finding.status === "closed"}
              className="ds-focus-ring mt-1.5 w-full rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2 text-sm text-ds-ink"
            >
              <option value="">Not a known contact</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.email ? `(${c.email})` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={pending || finding.status === "closed"}
            onClick={() =>
              run(() =>
                assignFindingOwner(finding.id, {
                  ownerName,
                  ownerEmail,
                  ownerOrganisation,
                  ownerContactId: ownerContactId || null,
                }),
              )
            }
          >
            Save owner
          </Button>
          <Button
            variant="secondary"
            disabled={pending || finding.status === "closed" || !finding.ownerContactId}
            onClick={() => run(() => sendClosureRequest(finding.id))}
          >
            Send closure request
          </Button>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ds-ink">Closure evidence</h3>
        {finding.closureEvidenceText && <p className="mt-1.5 text-sm text-ds-ink">{finding.closureEvidenceText}</p>}
        {finding.evidence.length === 0 ? (
          <p className="mt-1.5 text-sm text-ds-ink-2">No evidence submitted yet.</p>
        ) : (
          <ul className="mt-1.5 grid gap-1 text-sm text-ds-ink">
            {finding.evidence.map((file) => (
              <li key={file.id}>{file.originalName}</li>
            ))}
          </ul>
        )}
      </section>

      {canRecordReviewDecision(finding.status) && (
        <section>
          <h3 className="text-sm font-semibold text-ds-ink">Reviewer decision</h3>
          <p className="mt-1 text-xs text-ds-ink-2">Partial closure is not acceptance — reject with a reason and a new due date instead.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              disabled={pending || finding.evidence.length === 0}
              onClick={() => run(() => reviewFindingClosure(finding.id, { decision: "accepted", reason: null, newDueDate: null }))}
            >
              Accept closure
            </Button>
          </div>
          <Textarea label="Rejection reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="mt-3" />
          <Field label="New due date" type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} className="mt-2" />
          <Button
            variant="secondary"
            className="mt-2"
            disabled={pending || !rejectReason.trim() || !newDueDate}
            onClick={() => run(() => reviewFindingClosure(finding.id, { decision: "rejected", reason: rejectReason, newDueDate }))}
          >
            Reject closure
          </Button>
        </section>
      )}

      {finding.reviewerDecision && (
        <section>
          <h3 className="text-sm font-semibold text-ds-ink">Last review</h3>
          <p className="mt-1 text-sm text-ds-ink">
            {finding.reviewerDecision === "accepted" ? "Accepted." : `Rejected — ${finding.reviewerDecisionReason}`}
          </p>
        </section>
      )}

      {canReopen(finding.status) && (
        <section>
          <Button variant="secondary" disabled={pending} onClick={() => run(() => reopenFinding(finding.id))}>
            Reopen
          </Button>
        </section>
      )}

      {error && <p className="text-sm text-ds-bad">{error}</p>}

      <section>
        <h3 className="text-sm font-semibold text-ds-ink">Cross-cycle history</h3>
        <ul className="mt-2 grid gap-1.5">
          {findingHistory.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 text-sm text-ds-ink">
              <span className="text-xs text-ds-ink-2">{entry.createdAt.slice(0, 10)}</span>
              <Pill tone={OUTCOME_TONE[entry.outcome]}>{entry.outcome}</Pill>
              {entry.isRecurrence && <Pill tone="warn">recurred</Pill>}
              {entry.id === finding.id && <span className="text-xs text-ds-ink-2">(this finding)</span>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ds-ink">Timeline</h3>
        <ul className="mt-2 grid gap-1.5">
          {events.length === 0 && <li className="text-sm text-ds-ink-2">No events yet.</li>}
          {events.map((event, index) => (
            <li key={index} className="text-sm text-ds-ink">
              <span className="text-xs text-ds-ink-2">{event.createdAt.slice(0, 10)}</span> — {event.eventType}
              {event.note && <span className="text-ds-ink-2"> ({event.note})</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
