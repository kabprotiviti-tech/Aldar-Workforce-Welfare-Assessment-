"use client";

import { useState, useTransition } from "react";
import { analyseInspectionPhoto, resolvePhotoAnalysis } from "@/lib/vision/actions";
import { getPhotoClass } from "@/lib/vision/classes";
import { derivedFactFor } from "@/lib/vision/derived-facts";
import { OBSERVED_LABELS, PHOTO_ANALYSIS_NOTICE, readingSummary, type InspectionPhotoView } from "@/lib/vision/store";
import type { ConfirmedReading } from "@/lib/vision/resolve";
import { Button } from "@/components/ds/button";
import { Pill, type PillTone } from "@/components/ds/pill";

/**
 * One photograph, its analysis beside it, and the assessor's decision
 * (this prompt: "the assessor sees the analysis beside the photo and
 * accepts, edits or rejects").
 *
 * Two things are deliberately given the same visual weight as the
 * readings: what the photograph cannot establish, and the fact that a
 * reading only becomes a fact when the assessor types the value in
 * themselves. Both are the feature, not fine print.
 */

const STATUS_TONE: Record<string, PillTone> = { proposed: "neutral", accepted: "ok", edited: "ok", rejected: "bad" };
const OBSERVED_TONE: Record<string, PillTone> = { present: "info", absent: "neutral", unclear: "warn" };

export function PhotoAnalysisPanel({
  assessmentId,
  photo,
  onChanged,
}: {
  assessmentId: string;
  photo: InspectionPhotoView;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  /** Values the assessor has typed, keyed by field. A field only becomes a fact once it has one. */
  const [values, setValues] = useState<Record<string, string>>({});
  const [factKeys, setFactKeys] = useState<Record<string, string>>({});

  const analysis = photo.analysis;
  const definition = photo.photoClass ? getPhotoClass(photo.photoClass) : null;

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onChanged();
    });
  }

  function confirmedReadings(): ConfirmedReading[] {
    if (!analysis || !photo.photoClass) return [];
    const confirmed: ConfirmedReading[] = [];
    for (const reading of analysis.readings) {
      if (reading.derivedFact === null) continue;
      const value = (values[reading.field] ?? "").trim();
      if (value.length === 0) continue;
      const derived = derivedFactFor(photo.photoClass, reading.field);
      confirmed.push({
        field: reading.field,
        factKey: factKeys[reading.field] ?? derived?.factKeyChoices[0] ?? "",
        value,
      });
    }
    return confirmed;
  }

  return (
    <article className="rounded-ds-card border border-ds-line bg-ds-surface p-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
        <div>
          {photo.signedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage URL, not a static asset next/image can optimise
            <img
              src={photo.signedUrl}
              alt={`Inspection photograph${photo.roomRef ? ` of ${photo.roomRef}` : ""}`}
              className="w-full rounded-ds-control border border-ds-line object-cover"
            />
          ) : (
            <div className="flex h-32 items-center justify-center rounded-ds-control border border-dashed border-ds-line text-xs text-ds-ink-2">
              Image unavailable
            </div>
          )}
          <p className="mt-1.5 text-xs text-ds-ink-2">
            {definition?.label ?? "Not classified"}
            {photo.roomRef ? ` · ${photo.roomRef}` : ""}
            {photo.capturedAt ? ` · ${new Date(photo.capturedAt).toLocaleString()}` : ""}
          </p>
          {photo.requirementTitle && <p className="text-xs text-ds-ink-2">{photo.requirementTitle}</p>}
        </div>

        <div>
          <p role="note" className="rounded-ds-control border-l-4 border-l-ds-warn bg-ds-surface-2 px-2.5 py-1.5 text-xs font-medium text-ds-ink">
            {PHOTO_ANALYSIS_NOTICE}
          </p>

          {!photo.photoClass && (
            <p className="mt-2 text-xs text-ds-ink-2">
              This was captured as a record shot. Only a classified photograph is analysed, and the class is the assessor&apos;s to set.
            </p>
          )}

          {photo.photoClass && !analysis && (
            <div className="mt-2">
              <Button variant="secondary" disabled={pending} onClick={() => run(() => analyseInspectionPhoto(photo.id, assessmentId))}>
                {pending ? "Analysing…" : "Analyse photograph"}
              </Button>
            </div>
          )}

          {analysis && (
            <>
              <div className="mt-2 flex items-center gap-2">
                <Pill tone={STATUS_TONE[analysis.status] ?? "neutral"}>{analysis.status}</Pill>
                <span className="text-xs text-ds-ink-2">{analysis.model}</span>
              </div>

              {analysis.error && <p className="mt-2 text-xs text-ds-warn">The analysis could not be read: {analysis.error}</p>}

              {analysis.readings.length > 0 && (
                <ul className="mt-2 divide-y divide-ds-line border-y border-ds-line">
                  {analysis.readings.map((reading) => {
                    const derived = photo.photoClass ? derivedFactFor(photo.photoClass, reading.field) : null;
                    const canBecomeFact = reading.derivedFact !== null && derived !== null && analysis.status === "proposed";
                    return (
                      <li key={reading.field} className="py-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-ds-ink">{reading.description}</p>
                            <p className="text-xs text-ds-ink-2">{readingSummary(reading)}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Pill tone={OBSERVED_TONE[reading.observed] ?? "neutral"}>{OBSERVED_LABELS[reading.observed]}</Pill>
                            <span className="text-xs text-ds-ink-2">{reading.confidence}</span>
                          </div>
                        </div>

                        {canBecomeFact && (
                          <div className="mt-1.5 rounded-ds-control bg-ds-surface-2 p-2">
                            <p className="text-xs text-ds-ink-2">
                              {derived!.valueType === "date"
                                ? `Read the date off the photograph and enter it. The printed text is “${reading.derivedFact!.verbatimText}” — the platform will not resolve it for you.`
                                : "Confirm the reading to record it as a fact."}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              {derived!.factKeyChoices.length > 1 && (
                                <select
                                  aria-label={`Record ${derived!.label} as`}
                                  value={factKeys[reading.field] ?? derived!.factKeyChoices[0]}
                                  onChange={(event) => setFactKeys((current) => ({ ...current, [reading.field]: event.target.value }))}
                                  className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-xs text-ds-ink"
                                >
                                  {derived!.factKeyChoices.map((key) => (
                                    <option key={key} value={key}>
                                      {key}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <input
                                aria-label={derived!.label}
                                type={derived!.valueType === "date" ? "date" : "text"}
                                value={values[reading.field] ?? ""}
                                onChange={(event) => setValues((current) => ({ ...current, [reading.field]: event.target.value }))}
                                placeholder={derived!.valueType === "date" ? "YYYY-MM-DD" : derived!.label}
                                className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-xs text-ds-ink"
                              />
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <section className="mt-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-ds-ink-2">What this photograph cannot establish</h4>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {analysis.cannotDetermine.map((entry) => (
                    <li key={entry} className="text-xs text-ds-ink-2">
                      {entry}
                    </li>
                  ))}
                </ul>
              </section>

              {analysis.suppressed.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-ds-ink-2">
                    {analysis.suppressed.length} response value(s) removed before you saw this
                  </summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {analysis.suppressed.map((entry) => (
                      <li key={entry} className="text-xs text-ds-ink-2">
                        {entry}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {analysis.status === "rejected" && analysis.rejectionReason && (
                <p className="mt-2 text-xs text-ds-ink-2">Rejected: {analysis.rejectionReason}</p>
              )}

              {analysis.status === "proposed" && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <Button
                    disabled={pending}
                    onClick={() =>
                      run(() =>
                        resolvePhotoAnalysis({ analysisId: analysis.id, assessmentId, action: "accept", confirmed: confirmedReadings() }),
                      )
                    }
                  >
                    Accept
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() =>
                      run(() =>
                        resolvePhotoAnalysis({
                          analysisId: analysis.id,
                          assessmentId,
                          action: "edit",
                          editedReadings: analysis.readings,
                          confirmed: confirmedReadings(),
                        }),
                      )
                    }
                  >
                    Accept with my corrections
                  </Button>
                  <Button variant="secondary" disabled={pending} onClick={() => setRejecting((open) => !open)}>
                    Reject
                  </Button>
                </div>
              )}

              {rejecting && analysis.status === "proposed" && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <input
                    aria-label="Reason for rejecting this analysis"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Why is this analysis wrong?"
                    className="ds-focus-ring min-w-0 flex-1 rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-xs text-ds-ink"
                  />
                  <Button
                    disabled={pending}
                    onClick={() =>
                      run(() => resolvePhotoAnalysis({ analysisId: analysis.id, assessmentId, action: "reject", rejectionReason: reason }))
                    }
                  >
                    Confirm rejection
                  </Button>
                </div>
              )}
            </>
          )}

          {error && <p className="mt-2 text-xs text-ds-warn">{error}</p>}
        </div>
      </div>
    </article>
  );
}
