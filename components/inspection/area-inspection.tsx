"use client";

import { useState } from "react";
import { QUESTION_ANSWERS, COMPLIANCE_RATINGS, type ComplianceRating, type QuestionAnswer } from "@/lib/rules/constants";
import { validateQuestionResult, validateRatedEntity } from "@/lib/rules/validation";
import { newMutationId } from "@/lib/inspection/queue";
import { capturePhoto } from "@/lib/inspection/photo";
import { SyncStatusBar, useInspectionQueue } from "@/components/inspection/sync-status";
import { Button } from "@/components/ds/button";
import { Pill } from "@/components/ds/pill";

export interface InspectionQuestion {
  id: string;
  text: string;
}

export interface InspectionArea {
  assessmentItemId: string;
  requirementId: string;
  slNo: number;
  title: string;
  questions: InspectionQuestion[];
  status: ComplianceRating | null;
}

export interface AreaInspectionProps {
  assessmentId: string;
  facilityName: string;
  subjectCode: string;
  areas: InspectionArea[];
}

/**
 * The on-site inspection (this prompt): mobile-first, one area at a
 * time, every capture written to the device before the UI acknowledges
 * it.
 *
 * Nothing here waits on the network. Every control writes to the
 * IndexedDB queue and returns; the sync bar at the top is the only place
 * connectivity is mentioned, and the only place it can block anything.
 */
export function AreaInspection({ assessmentId, facilityName, subjectCode, areas }: AreaInspectionProps) {
  const { unsynced, syncing, online, lastError, sync, enqueue } = useInspectionQueue();
  const [activeIndex, setActiveIndex] = useState(0);
  const area = areas[activeIndex];

  if (!area) {
    return <p className="text-sm text-ds-ink-2">This assessment has no accommodation areas.</p>;
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-24">
      <SyncStatusBar unsynced={unsynced} syncing={syncing} online={online} lastError={lastError} onSync={sync} />

      <header className="pt-4">
        <h1 className="text-base font-semibold text-ds-ink">{facilityName}</h1>
        <p className="text-xs text-ds-ink-2">{subjectCode}</p>
      </header>

      {/* Area strip: thumb-reachable, scrolls horizontally rather than
          wrapping into a wall of chips on a narrow screen. */}
      <div className="mt-3 -mx-4 overflow-x-auto px-4">
        <div className="flex gap-1.5 pb-1">
          {areas.map((entry, index) => (
            <button
              key={entry.assessmentItemId}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-current={index === activeIndex ? "step" : undefined}
              className={`ds-focus-ring shrink-0 rounded-ds-control border px-2.5 py-1.5 text-xs transition-colors duration-150 ${
                index === activeIndex ? "border-ds-accent bg-ds-accent-soft font-medium text-ds-ink" : "border-ds-line bg-ds-surface text-ds-ink-2"
              }`}
            >
              {entry.slNo}
              {entry.status && <span className="ml-1 text-ds-ok">✓</span>}
            </button>
          ))}
        </div>
      </div>

      <AreaPanel key={area.assessmentItemId} assessmentId={assessmentId} area={area} onEnqueue={enqueue} />

      <div className="mt-6 flex justify-between gap-2">
        <Button variant="secondary" disabled={activeIndex === 0} onClick={() => setActiveIndex((index) => index - 1)}>
          Previous area
        </Button>
        <Button variant="secondary" disabled={activeIndex === areas.length - 1} onClick={() => setActiveIndex((index) => index + 1)}>
          Next area
        </Button>
      </div>
    </div>
  );
}

type EnqueueFn = ReturnType<typeof useInspectionQueue>["enqueue"];

function AreaPanel({ assessmentId, area, onEnqueue }: { assessmentId: string; area: InspectionArea; onEnqueue: EnqueueFn }) {
  return (
    <div className="mt-4 grid gap-5">
      <div>
        <h2 className="text-sm font-semibold text-ds-ink">
          Area {area.slNo}: {area.title}
        </h2>
      </div>

      <Questions assessmentId={assessmentId} area={area} onEnqueue={onEnqueue} />
      <Quantitative assessmentId={assessmentId} area={area} onEnqueue={onEnqueue} />
      <RoomCounts assessmentId={assessmentId} onEnqueue={onEnqueue} />
      <Photos assessmentId={assessmentId} area={area} onEnqueue={onEnqueue} />
      <Certificates assessmentId={assessmentId} area={area} onEnqueue={onEnqueue} />
      <AreaRating assessmentId={assessmentId} area={area} onEnqueue={onEnqueue} />
    </div>
  );
}

function Questions({ assessmentId, area, onEnqueue }: { assessmentId: string; area: InspectionArea; onEnqueue: EnqueueFn }) {
  const [answers, setAnswers] = useState<Record<string, { answer: QuestionAnswer | null; remark: string; action: string }>>({});

  if (area.questions.length === 0) {
    return (
      <section className="rounded-ds-control border border-dashed border-ds-line bg-ds-surface-2 px-3 py-2.5">
        <h3 className="text-xs font-semibold text-ds-ink">Key questions</h3>
        {/* The Accommodation template's key questions are real regulatory
            content still pending from the client (0010's seed leaves
            public.questions empty for this module) — stated rather than
            invented. */}
        <p className="mt-1 text-xs text-ds-ink-2">
          No key questions have been supplied for this area yet. Quantitative capture, photos and the area rating below are unaffected.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ds-ink-2">Key questions</h3>
      <div className="mt-2 grid gap-3">
        {area.questions.map((question) => {
          const current = answers[question.id] ?? { answer: null, remark: "", action: "" };
          const issues = current.answer
            ? validateQuestionResult({
                questionId: question.id,
                answer: current.answer,
                remark: current.remark.trim() || null,
                actionRequiredForClosure: current.action.trim() || null,
              })
            : [];

          return (
            <div key={question.id} className="rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2.5">
              <p className="text-sm text-ds-ink">{question.text}</p>

              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {QUESTION_ANSWERS.map((answer) => (
                  <button
                    key={answer}
                    type="button"
                    onClick={() => setAnswers((prev) => ({ ...prev, [question.id]: { ...current, answer } }))}
                    className={`ds-focus-ring rounded-ds-control border px-2 py-2 text-sm transition-colors duration-150 ${
                      current.answer === answer ? "border-ds-accent bg-ds-accent-soft font-medium text-ds-ink" : "border-ds-line bg-ds-surface text-ds-ink-2"
                    }`}
                  >
                    {answer}
                  </button>
                ))}
              </div>

              {current.answer && (
                <div className="mt-2 grid gap-1.5">
                  <textarea
                    aria-label="Remark"
                    placeholder="Remark"
                    rows={2}
                    value={current.remark}
                    onChange={(event) => setAnswers((prev) => ({ ...prev, [question.id]: { ...current, remark: event.target.value } }))}
                    className="ds-focus-ring w-full rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1.5 text-sm text-ds-ink"
                  />
                  <textarea
                    aria-label="Action required for closure"
                    placeholder="Action required for closure"
                    rows={2}
                    value={current.action}
                    onChange={(event) => setAnswers((prev) => ({ ...prev, [question.id]: { ...current, action: event.target.value } }))}
                    className="ds-focus-ring w-full rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1.5 text-sm text-ds-ink"
                  />
                  {issues.map((issue) => (
                    <p key={issue.field} className="text-xs text-ds-bad">
                      {issue.message}
                    </p>
                  ))}
                  <Button
                    className="px-2 py-1 text-xs"
                    disabled={issues.length > 0}
                    onClick={() =>
                      onEnqueue({
                        clientMutationId: newMutationId(),
                        assessmentId,
                        kind: "area_answer",
                        capturedAt: new Date().toISOString(),
                        payload: {
                          assessment_item_id: area.assessmentItemId,
                          question_id: question.id,
                          answer: current.answer,
                          remark: current.remark.trim() || null,
                          action_required: current.action.trim() || null,
                        },
                      })
                    }
                  >
                    Save answer
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Quantitative({ assessmentId, area, onEnqueue }: { assessmentId: string; area: InspectionArea; onEnqueue: EnqueueFn }) {
  const [fields, setFields] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ds-ink-2">Quantitative capture</h3>
      <p className="mt-1 text-xs text-ds-ink-2">
        One field per line, as <code>key: value</code>. These feed the rule engine once synced.
      </p>
      <textarea
        aria-label="Quantitative fields"
        rows={4}
        value={fields}
        placeholder={"residents: 96\ntoilets: 12\nshowers: 12\nwashbasins: 12"}
        onChange={(event) => {
          setFields(event.target.value);
          setSaved(false);
        }}
        className="ds-focus-ring mt-1.5 w-full rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1.5 font-mono text-sm text-ds-ink"
      />
      {error && <p className="mt-1 text-xs text-ds-bad">{error}</p>}
      {saved && <p className="mt-1 text-xs text-ds-ok">Queued.</p>}
      <Button
        variant="secondary"
        className="mt-2 px-2 py-1 text-xs"
        onClick={async () => {
          const parsed = parseQuantitativeLines(fields);
          if (!parsed.ok) {
            setError(parsed.message);
            return;
          }
          setError(null);
          await onEnqueue({
            clientMutationId: newMutationId(),
            assessmentId,
            kind: "area_quantitative",
            capturedAt: new Date().toISOString(),
            payload: { assessment_item_id: area.assessmentItemId, quantitative: parsed.value },
          });
          setSaved(true);
        }}
      >
        Save quantitative
      </Button>
    </section>
  );
}

/** "key: value" lines into an object, with numbers kept as numbers so the rule engine can compare them. */
export function parseQuantitativeLines(input: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  const value: Record<string, unknown> = {};
  for (const rawLine of input.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const separator = line.indexOf(":");
    if (separator === -1) return { ok: false, message: `"${line}" is not "key: value".` };
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    if (key.length === 0 || raw.length === 0) return { ok: false, message: `"${line}" is missing a key or a value.` };
    const numeric = Number(raw);
    value[key] = raw !== "" && Number.isFinite(numeric) ? numeric : raw;
  }
  if (Object.keys(value).length === 0) return { ok: false, message: "Enter at least one field." };
  return { ok: true, value };
}

function RoomCounts({ assessmentId, onEnqueue }: { assessmentId: string; onEnqueue: EnqueueFn }) {
  const [roomRef, setRoomRef] = useState("");
  const [beds, setBeds] = useState("");
  const [occupancy, setOccupancy] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  const ready = roomRef.trim().length > 0 && beds.trim() !== "" && occupancy.trim() !== "";

  return (
    <section className="rounded-ds-control border border-ds-line bg-ds-surface-2 px-3 py-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ds-ink-2">Room counts (your physical count)</h3>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <input
          aria-label="Room reference"
          placeholder="Room"
          value={roomRef}
          onChange={(event) => setRoomRef(event.target.value)}
          className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-2 py-2 text-sm text-ds-ink"
        />
        <input
          aria-label="Bed count"
          placeholder="Beds"
          inputMode="numeric"
          value={beds}
          onChange={(event) => setBeds(event.target.value)}
          className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-2 py-2 text-sm text-ds-ink"
        />
        <input
          aria-label="Occupancy count"
          placeholder="Occupants"
          inputMode="numeric"
          value={occupancy}
          onChange={(event) => setOccupancy(event.target.value)}
          className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-2 py-2 text-sm text-ds-ink"
        />
      </div>
      {saved && <p className="mt-1 text-xs text-ds-ok">{saved} queued.</p>}
      <Button
        variant="secondary"
        className="mt-2 px-2 py-1 text-xs"
        disabled={!ready}
        onClick={async () => {
          await onEnqueue({
            clientMutationId: newMutationId(),
            assessmentId,
            kind: "room_count",
            capturedAt: new Date().toISOString(),
            payload: { room_ref: roomRef.trim(), bed_count: Number(beds), occupancy_count: Number(occupancy) },
          });
          setSaved(roomRef.trim());
          setRoomRef("");
          setBeds("");
          setOccupancy("");
        }}
      >
        Save room
      </Button>
    </section>
  );
}

function Photos({ assessmentId, area, onEnqueue }: { assessmentId: string; area: InspectionArea; onEnqueue: EnqueueFn }) {
  const [roomRef, setRoomRef] = useState("");
  const [queued, setQueued] = useState(0);
  const [busy, setBusy] = useState(false);

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ds-ink-2">Photos</h3>
      <input
        aria-label="Room reference for photos"
        placeholder="Room reference (optional)"
        value={roomRef}
        onChange={(event) => setRoomRef(event.target.value)}
        className="ds-focus-ring mt-1.5 w-full rounded-ds-control border border-ds-line bg-ds-surface px-2 py-2 text-sm text-ds-ink"
      />
      {/* capture="environment" opens the rear camera directly on a phone
          rather than a file picker. */}
      <label className="ds-focus-ring mt-2 block cursor-pointer rounded-ds-control border border-dashed border-ds-line bg-ds-surface-2 px-3 py-4 text-center text-sm text-ds-ink-2">
        {busy ? "Processing…" : "Take photo"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          disabled={busy}
          className="hidden"
          onChange={async (event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length === 0) return;
            setBusy(true);
            for (const file of files) {
              const captured = await capturePhoto(file);
              await onEnqueue({
                clientMutationId: newMutationId(),
                assessmentId,
                kind: "photo",
                capturedAt: captured.capturedAt,
                blob: captured.blob,
                payload: {
                  requirement_id: area.requirementId,
                  room_ref: roomRef.trim(),
                  captured_at: captured.capturedAt,
                  geo_lat: captured.geoLat,
                  geo_lng: captured.geoLng,
                },
              });
              setQueued((count) => count + 1);
            }
            setBusy(false);
          }}
        />
      </label>
      {queued > 0 && <p className="mt-1 text-xs text-ds-ink-2">{queued} photo(s) captured in this area.</p>}
    </section>
  );
}

function Certificates({ assessmentId, area, onEnqueue }: { assessmentId: string; area: InspectionArea; onEnqueue: EnqueueFn }) {
  const [type, setType] = useState("Civil Defence");
  const [number, setNumber] = useState("");
  const [validTo, setValidTo] = useState("");
  const [saved, setSaved] = useState(false);

  return (
    <section className="rounded-ds-control border border-ds-line bg-ds-surface-2 px-3 py-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ds-ink-2">Certificate</h3>
      <div className="mt-2 grid gap-1.5">
        <input
          aria-label="Certificate type"
          value={type}
          onChange={(event) => setType(event.target.value)}
          className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-2 py-2 text-sm text-ds-ink"
        />
        <input
          aria-label="Certificate number"
          placeholder="Certificate number"
          value={number}
          onChange={(event) => setNumber(event.target.value)}
          className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-2 py-2 text-sm text-ds-ink"
        />
        <label className="text-xs text-ds-ink-2" htmlFor="certificate-expiry">
          Expiry date (yours to confirm, even where extraction proposes one)
        </label>
        <input
          id="certificate-expiry"
          type="date"
          value={validTo}
          onChange={(event) => setValidTo(event.target.value)}
          className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-2 py-2 text-sm text-ds-ink"
        />
      </div>
      {saved && <p className="mt-1 text-xs text-ds-ok">Certificate queued.</p>}
      <Button
        variant="secondary"
        className="mt-2 px-2 py-1 text-xs"
        disabled={type.trim().length === 0 || validTo === ""}
        onClick={async () => {
          await onEnqueue({
            clientMutationId: newMutationId(),
            assessmentId,
            kind: "certificate",
            capturedAt: new Date().toISOString(),
            payload: {
              assessment_item_id: area.assessmentItemId,
              certificate: { type: type.trim(), number: number.trim() || null, issued_by: null, valid_from: null, valid_to: validTo },
            },
          });
          setSaved(true);
          setNumber("");
        }}
      >
        Save certificate
      </Button>
    </section>
  );
}

function AreaRating({ assessmentId, area, onEnqueue }: { assessmentId: string; area: InspectionArea; onEnqueue: EnqueueFn }) {
  const [rating, setRating] = useState<ComplianceRating | "">(area.status ?? "");
  const [remark, setRemark] = useState("");
  const [action, setAction] = useState("");
  const [saved, setSaved] = useState(false);

  const issues =
    rating === ""
      ? []
      : validateRatedEntity({ rating, remark: remark.trim() || null, actionRequiredForClosure: action.trim() || null });

  return (
    <section className="rounded-ds-card border border-ds-line bg-ds-surface p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ds-ink-2">Area rating</h3>
      <p className="mt-1 text-xs text-ds-ink-2">Set after the questions are answered. This is your decision, not the platform&rsquo;s.</p>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {COMPLIANCE_RATINGS.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => {
              setRating(entry);
              setSaved(false);
            }}
            className={`ds-focus-ring rounded-ds-control border px-2 py-2 text-sm transition-colors duration-150 ${
              rating === entry ? "border-ds-accent bg-ds-accent-soft font-medium text-ds-ink" : "border-ds-line bg-ds-surface text-ds-ink-2"
            }`}
          >
            {entry}
          </button>
        ))}
      </div>

      <textarea
        aria-label="Area remark"
        placeholder="Remark"
        rows={2}
        value={remark}
        onChange={(event) => setRemark(event.target.value)}
        className="ds-focus-ring mt-2 w-full rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1.5 text-sm text-ds-ink"
      />
      <textarea
        aria-label="Area action required for closure"
        placeholder="Action required for closure"
        rows={2}
        value={action}
        onChange={(event) => setAction(event.target.value)}
        className="ds-focus-ring mt-1.5 w-full rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1.5 text-sm text-ds-ink"
      />

      {issues.map((issue) => (
        <p key={issue.field} className="mt-1 text-xs text-ds-bad">
          {issue.message}
        </p>
      ))}
      {saved && (
        <p className="mt-1 text-xs text-ds-ok">
          Rating queued. <Pill tone="info">syncs as your decision</Pill>
        </p>
      )}

      <Button
        className="mt-2"
        disabled={rating === "" || issues.length > 0}
        onClick={async () => {
          await onEnqueue({
            clientMutationId: newMutationId(),
            assessmentId,
            kind: "area_rating",
            capturedAt: new Date().toISOString(),
            payload: {
              assessment_item_id: area.assessmentItemId,
              compliance_status: rating,
              remarks: remark.trim() || null,
              action_required: action.trim() || null,
            },
          });
          setSaved(true);
        }}
      >
        Save area rating
      </Button>
    </section>
  );
}
