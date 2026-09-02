"use client";

import { useState, useTransition } from "react";
import { acceptFact, bulkAcceptFacts, editFact, rejectFact } from "@/lib/facts/actions";
import {
  bulkAcceptableIds,
  factKeyLabel,
  formatFactValue,
  isBulkAcceptable,
  isConfirmed,
  ledgerProgress,
  parsePageRef,
  partitionByConfidence,
  progressLabel,
  type LedgerFact,
} from "@/lib/facts/ledger";
import { Button } from "@/components/ds/button";
import { Pill, type PillTone } from "@/components/ds/pill";
import { ProgressBar } from "@/components/ds/progress-bar";
import { EmptyState } from "@/components/ds/empty-state";

export interface FactLedgerProps {
  assessmentId: string;
  facts: LedgerFact[];
  /** Called when a fact is clicked, so the preview can scroll to its page and highlight its region. */
  onFocusFact: (fact: LedgerFact) => void;
  focusedFactId: string | null;
  onResolved: () => void;
}

const CONFIDENCE_TONE: Record<string, PillTone> = { high: "ok", medium: "warn", low: "bad" };
const STATUS_TONE: Record<string, PillTone> = { proposed: "neutral", accepted: "ok", edited: "info", rejected: "bad" };
const STATUS_LABEL: Record<string, string> = { proposed: "Proposed", accepted: "Accepted", edited: "Edited", rejected: "Rejected" };

/**
 * The fact ledger: the human gate between extraction and everything
 * downstream (this prompt). Every value here is `proposed` until an
 * assessor accepts, edits or rejects it — and nothing downstream can read
 * it until then, because downstream reads the fact_ledger_confirmed view
 * instead (0021_fact_ledger.sql).
 */
export function FactLedger({ assessmentId, facts, onFocusFact, focusedFactId, onResolved }: FactLedgerProps) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const progress = ledgerProgress(facts);
  const { primary, lowConfidence } = partitionByConfidence(facts);
  const bulkIds = bulkAcceptableIds(facts);

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onResolved();
    });
  }

  function handleBulkAccept() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await bulkAcceptFacts(bulkIds, assessmentId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(`Accepted ${result.accepted} high-confidence fact${result.accepted === 1 ? "" : "s"}.`);
      onResolved();
    });
  }

  if (facts.length === 0) {
    return (
      <EmptyState
        title="No facts yet"
        description="Extract facts from this document to review them here. Nothing reaches an assessment until a person confirms it."
      />
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ds-ink">Fact ledger</h2>
        <p className="text-xs tabular-nums text-ds-ink-2">{progressLabel(progress)}</p>
      </div>

      <ProgressBar className="mt-2" value={progress.total === 0 ? 0 : Math.round((progress.confirmed / progress.total) * 100)} />

      <p className="mt-1.5 text-xs text-ds-ink-2">
        {progress.pending} to review
        {progress.rejected > 0 && ` · ${progress.rejected} rejected`}
      </p>

      {bulkIds.length > 0 && (
        <Button variant="secondary" className="mt-3 w-full" disabled={pending} onClick={handleBulkAccept}>
          Accept {bulkIds.length} high-confidence fact{bulkIds.length === 1 ? "" : "s"}
        </Button>
      )}

      {message && <p className="mt-2 text-xs text-ds-ok">{message}</p>}
      {error && <p className="mt-2 text-xs text-ds-bad">{error}</p>}

      <div className="mt-3 grid gap-2">
        {primary.map((fact) => (
          <FactRow
            key={fact.id}
            fact={fact}
            assessmentId={assessmentId}
            focused={fact.id === focusedFactId}
            pending={pending}
            onFocus={() => onFocusFact(fact)}
            onRun={run}
          />
        ))}
      </div>

      {lowConfidence.length > 0 && (
        // Visually separated and excluded from bulk accept (this prompt) —
        // a low-confidence fact is exactly the kind a bulk action would
        // wave through without anyone actually reading it.
        <div className="mt-5 rounded-ds-card border border-ds-bad bg-ds-surface-2 p-3">
          <p className="text-xs font-semibold text-ds-bad">Low confidence — review individually</p>
          <p className="mt-0.5 text-xs text-ds-ink-2">
            These can&rsquo;t be bulk accepted. Check each one against the document before confirming it.
          </p>
          <div className="mt-2.5 grid gap-2">
            {lowConfidence.map((fact) => (
              <FactRow
                key={fact.id}
                fact={fact}
                assessmentId={assessmentId}
                focused={fact.id === focusedFactId}
                pending={pending}
                onFocus={() => onFocusFact(fact)}
                onRun={run}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FactRow({
  fact,
  assessmentId,
  focused,
  pending,
  onFocus,
  onRun,
}: {
  fact: LedgerFact;
  assessmentId: string;
  focused: boolean;
  pending: boolean;
  onFocus: () => void;
  onRun: (action: () => Promise<{ ok: true } | { ok: false; message: string }>) => void;
}) {
  const [mode, setMode] = useState<"idle" | "edit" | "reject">("idle");
  const [draftValue, setDraftValue] = useState(() => formatFactValue(fact.confirmedValue, null, fact.reason));
  const [draftReason, setDraftReason] = useState("");

  const page = parsePageRef(fact.pageRef);
  const confirmed = isConfirmed(fact.status);

  return (
    <div className={`rounded-ds-control border px-3 py-2.5 ${focused ? "border-ds-accent bg-ds-accent-soft" : "border-ds-line bg-ds-surface"}`}>
      <button type="button" onClick={onFocus} className="ds-focus-ring w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-ds-ink">{factKeyLabel(fact.factKey)}</p>
          <div className="flex shrink-0 items-center gap-1">
            {fact.confidence && <Pill tone={CONFIDENCE_TONE[fact.confidence] ?? "neutral"}>{fact.confidence}</Pill>}
            <Pill tone={STATUS_TONE[fact.status] ?? "neutral"}>{STATUS_LABEL[fact.status] ?? fact.status}</Pill>
          </div>
        </div>

        <p className="mt-1 text-sm text-ds-ink">{formatFactValue(fact.confirmedValue, fact.unit, fact.reason)}</p>

        {fact.status === "edited" && (
          <p className="mt-0.5 text-xs text-ds-ink-2">
            Model proposed: {formatFactValue(fact.proposedValue, fact.unit, fact.reason)}
          </p>
        )}
        {fact.status === "rejected" && fact.rejectionReason && (
          <p className="mt-0.5 text-xs text-ds-bad">Rejected: {fact.rejectionReason}</p>
        )}

        {/* The verbatim quote the model took the value from, and the page
            it came from — the two things that make a fact checkable
            rather than trusted (this prompt). */}
        {fact.verbatimQuote && <p className="mt-1.5 border-l-2 border-ds-line pl-2 text-xs italic text-ds-ink-2">&ldquo;{fact.verbatimQuote}&rdquo;</p>}
        <p className="mt-1 text-xs text-ds-ink-2">
          {fact.pageRef ?? "No page reference"}
          {page !== null && " · click to open"}
          {fact.bbox && " · region highlighted"}
        </p>
      </button>

      {mode === "idle" && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {!confirmed && (
            <Button variant="secondary" className="px-2 py-1 text-xs" disabled={pending} onClick={() => onRun(() => acceptFact(fact.id, assessmentId))}>
              Accept
            </Button>
          )}
          <Button variant="ghost" className="px-2 py-1 text-xs" disabled={pending} onClick={() => setMode("edit")}>
            {confirmed ? "Change value" : "Edit value"}
          </Button>
          {fact.status !== "rejected" && (
            <Button variant="ghost" className="px-2 py-1 text-xs text-ds-bad" disabled={pending} onClick={() => setMode("reject")}>
              Reject
            </Button>
          )}
        </div>
      )}

      {mode === "edit" && (
        <div className="mt-2 grid gap-1.5">
          <label className="text-xs text-ds-ink-2" htmlFor={`edit-${fact.id}`}>
            Corrected value{Array.isArray(fact.proposedValue) ? " (comma separated)" : ""}
          </label>
          <input
            id={`edit-${fact.id}`}
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            className="ds-focus-ring w-full rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-sm text-ds-ink"
          />
          <div className="flex gap-1.5">
            <Button
              className="px-2 py-1 text-xs"
              disabled={pending}
              onClick={() =>
                onRun(async () => {
                  const result = await editFact(fact.id, assessmentId, draftValue);
                  if (result.ok) setMode("idle");
                  return result;
                })
              }
            >
              Save value
            </Button>
            <Button variant="ghost" className="px-2 py-1 text-xs" disabled={pending} onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === "reject" && (
        <div className="mt-2 grid gap-1.5">
          <label className="text-xs text-ds-ink-2" htmlFor={`reject-${fact.id}`}>
            Why is this wrong? (recorded in the audit trail)
          </label>
          <input
            id={`reject-${fact.id}`}
            value={draftReason}
            onChange={(event) => setDraftReason(event.target.value)}
            className="ds-focus-ring w-full rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-sm text-ds-ink"
          />
          <div className="flex gap-1.5">
            <Button
              className="px-2 py-1 text-xs"
              disabled={pending}
              onClick={() =>
                onRun(async () => {
                  const result = await rejectFact(fact.id, assessmentId, draftReason);
                  if (result.ok) setMode("idle");
                  return result;
                })
              }
            >
              Reject fact
            </Button>
            <Button variant="ghost" className="px-2 py-1 text-xs" disabled={pending} onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isBulkAcceptable(fact) && <span className="sr-only">Eligible for bulk accept</span>}
    </div>
  );
}
