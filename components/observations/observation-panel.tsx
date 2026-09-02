"use client";

import { useState, useTransition } from "react";
import { addObservation, confirmObservation, generateObservationsForItem, rejectObservation } from "@/lib/observations/actions";
import { OBSERVATION_KIND_LABELS, OBSERVATION_NOTICE, sourceSummary, type ObservationView } from "@/lib/observations/store";
import type { AiObservationKind } from "@/lib/db/evidence";
import { Button } from "@/components/ds/button";
import { Pill, type PillTone } from "@/components/ds/pill";
import { EmptyState } from "@/components/ds/empty-state";

export interface ObservationRequirementOption {
  assessmentItemId: string;
  requirementId: string;
  slNo: number;
  title: string;
}

export interface ObservationPanelProps {
  assessmentId: string;
  observations: ObservationView[];
  /** The assessment's requirements, so an assessor can attach a new observation to one. */
  requirements: ObservationRequirementOption[];
  onChanged: () => void;
}

const KIND_TONE: Record<AiObservationKind, PillTone> = {
  evidence_identified: "ok",
  potential_gap: "warn",
  requires_attention: "bad",
};

const STATUS_TONE: Record<string, PillTone> = { open: "neutral", confirmed: "ok", rejected: "bad", noted: "info" };

/**
 * The observation review panel (this prompt). Three actions — Confirm,
 * Reject with a reason, Add observation — and a notice that never
 * scrolls away, because the one thing a reader must not conclude from a
 * screen full of AI narrative is that the platform decided anything.
 */
export function ObservationPanel({ assessmentId, observations, requirements, onChanged }: ObservationPanelProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>, success?: string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (success) setMessage(success);
      onChanged();
    });
  }

  const open = observations.filter((observation) => observation.status === "open");
  const actioned = observations.filter((observation) => observation.status !== "open");

  return (
    <div>
      {/* The permanent notice this prompt requires. Sits above the list,
          not in a dismissible toast, and is rendered before any
          observation so it is read first. */}
      <p role="note" className="rounded-ds-control border-l-4 border-l-ds-warn bg-ds-surface px-3 py-2 text-xs font-medium text-ds-ink">
        {OBSERVATION_NOTICE}
      </p>

      <div className="mt-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ds-ink">Observations</h2>
        <p className="text-xs tabular-nums text-ds-ink-2">
          {open.length} to review · {observations.filter((o) => o.status === "confirmed").length} confirmed
        </p>
      </div>

      {requirements.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button variant="secondary" className="px-2 py-1 text-xs" disabled={pending} onClick={() => setAdding((value) => !value)}>
            {adding ? "Cancel" : "Add observation"}
          </Button>
          <Button
            variant="ghost"
            className="px-2 py-1 text-xs"
            disabled={pending}
            onClick={() =>
              run(
                async () => {
                  const result = await generateObservationsForItem(requirements[0]!.assessmentItemId, assessmentId);
                  return result.ok ? { ok: true } : result;
                },
                "Generated observations for review.",
              )
            }
          >
            Generate for requirement {requirements[0]!.slNo}
          </Button>
        </div>
      )}

      {adding && <AddObservationForm assessmentId={assessmentId} requirements={requirements} pending={pending} onRun={run} onDone={() => setAdding(false)} />}

      {message && <p className="mt-2 text-xs text-ds-ok">{message}</p>}
      {error && <p className="mt-2 text-xs text-ds-bad">{error}</p>}

      {observations.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title="No observations yet"
            description="Generate observations once facts are confirmed and rules have run, or add your own."
          />
        </div>
      ) : (
        <div className="mt-3 grid gap-2">
          {[...open, ...actioned].map((observation) => (
            <ObservationCard
              key={observation.id}
              observation={observation}
              assessmentId={assessmentId}
              pending={pending}
              onRun={run}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ObservationCard({
  observation,
  assessmentId,
  pending,
  onRun,
}: {
  observation: ObservationView;
  assessmentId: string;
  pending: boolean;
  onRun: (action: () => Promise<{ ok: true } | { ok: false; message: string }>, success?: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className="rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone={KIND_TONE[observation.kind]}>{OBSERVATION_KIND_LABELS[observation.kind]}</Pill>
        <Pill tone={STATUS_TONE[observation.status] ?? "neutral"}>{observation.status}</Pill>
        {observation.authoredBy === "assessor" && <Pill tone="info">yours</Pill>}
      </div>

      <p className="mt-1.5 text-sm font-medium text-ds-ink">{observation.title}</p>
      {observation.body && <p className="mt-1 text-xs text-ds-ink-2">{observation.body}</p>}

      {/* Source reference: an observation without one is discarded before
          it reaches this panel, so there is always something here. */}
      <p className="mt-1.5 text-xs text-ds-ink-2">Source: {sourceSummary(observation)}</p>

      {observation.status === "rejected" && observation.rejectionReason && (
        <p className="mt-1 text-xs text-ds-bad">Rejected: {observation.rejectionReason}</p>
      )}

      {observation.status === "open" && !rejecting && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            variant="secondary"
            className="px-2 py-1 text-xs"
            disabled={pending}
            onClick={() => onRun(() => confirmObservation(observation.id, assessmentId))}
          >
            Confirm
          </Button>
          <Button variant="ghost" className="px-2 py-1 text-xs text-ds-bad" disabled={pending} onClick={() => setRejecting(true)}>
            Reject
          </Button>
        </div>
      )}

      {rejecting && (
        <div className="mt-2 grid gap-1.5">
          <label className="text-xs text-ds-ink-2" htmlFor={`reject-observation-${observation.id}`}>
            Why is this wrong? (retained with the observation)
          </label>
          <input
            id={`reject-observation-${observation.id}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="ds-focus-ring w-full rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-sm text-ds-ink"
          />
          <div className="flex gap-1.5">
            <Button
              className="px-2 py-1 text-xs"
              disabled={pending}
              onClick={() =>
                onRun(async () => {
                  const result = await rejectObservation(observation.id, assessmentId, reason);
                  if (result.ok) setRejecting(false);
                  return result;
                })
              }
            >
              Reject observation
            </Button>
            <Button variant="ghost" className="px-2 py-1 text-xs" disabled={pending} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddObservationForm({
  assessmentId,
  requirements,
  pending,
  onRun,
  onDone,
}: {
  assessmentId: string;
  requirements: ObservationRequirementOption[];
  pending: boolean;
  onRun: (action: () => Promise<{ ok: true } | { ok: false; message: string }>, success?: string) => void;
  onDone: () => void;
}) {
  const [itemId, setItemId] = useState(requirements[0]!.assessmentItemId);
  const [kind, setKind] = useState<AiObservationKind>("requires_attention");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const selected = requirements.find((requirement) => requirement.assessmentItemId === itemId) ?? requirements[0]!;

  return (
    <div className="mt-2 grid gap-1.5 rounded-ds-control border border-ds-line bg-ds-surface-2 px-3 py-2.5">
      <label className="text-xs text-ds-ink-2" htmlFor="observation-requirement">
        Requirement
      </label>
      <select
        id="observation-requirement"
        value={itemId}
        onChange={(event) => setItemId(event.target.value)}
        className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-sm text-ds-ink"
      >
        {requirements.map((requirement) => (
          <option key={requirement.assessmentItemId} value={requirement.assessmentItemId}>
            {requirement.slNo}. {requirement.title}
          </option>
        ))}
      </select>

      <label className="text-xs text-ds-ink-2" htmlFor="observation-kind">
        Kind
      </label>
      <select
        id="observation-kind"
        value={kind}
        onChange={(event) => setKind(event.target.value as AiObservationKind)}
        className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-sm text-ds-ink"
      >
        {Object.entries(OBSERVATION_KIND_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <label className="text-xs text-ds-ink-2" htmlFor="observation-title">
        Title
      </label>
      <input
        id="observation-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-sm text-ds-ink"
      />

      <label className="text-xs text-ds-ink-2" htmlFor="observation-body">
        Detail
      </label>
      <textarea
        id="observation-body"
        value={body}
        rows={3}
        onChange={(event) => setBody(event.target.value)}
        className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-sm text-ds-ink"
      />

      <div className="mt-1 flex gap-1.5">
        <Button
          className="px-2 py-1 text-xs"
          disabled={pending}
          onClick={() =>
            onRun(async () => {
              const result = await addObservation(
                { assessmentItemId: selected.assessmentItemId, requirementId: selected.requirementId, kind, title, body },
                assessmentId,
              );
              if (result.ok) {
                setTitle("");
                setBody("");
                onDone();
              }
              return result;
            }, "Observation added.")
          }
        >
          Save observation
        </Button>
        <Button variant="ghost" className="px-2 py-1 text-xs" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
