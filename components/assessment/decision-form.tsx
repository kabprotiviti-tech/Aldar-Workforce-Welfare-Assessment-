"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { COMPLIANCE_RATINGS, type ComplianceRating } from "@/lib/rules/constants";
import { ASSESSOR_DECISION_STATEMENT, validateItemDecision } from "@/lib/assessment/decision";
import { saveDecision, saveInterviewInsights, saveObservationDrafts } from "@/lib/assessment/actions";
import { Button } from "@/components/ds/button";

export interface DecisionFormProps {
  assessmentId: string;
  assessmentItemId: string;
  requirementSlNo: number;
  requirementTitle: string;
  initial: {
    status: ComplianceRating | null;
    remarks: string;
    actionRequired: string;
    assessorObservations: string;
    officeVisitObservations: string;
    draftUpdatedAt: string | null;
  };
  interview: {
    workersInterviewedCount: number | null;
    nationalities: string[];
    interpreterUsed: boolean | null;
    notes: string;
  };
}

const AUTOSAVE_DELAY_MS = 1500;

/**
 * The decision half of the requirement page: the drafting an assessor
 * does while reading the evidence, the interview insights, and the
 * status itself.
 *
 * Drafts autosave to the server rather than to browser storage, so the
 * text is still there after a refresh, on another device, and after a
 * crashed tab — the page renders them from the database on load, which is
 * what makes "draft text survives a browser refresh" true rather than
 * merely likely.
 */
export function DecisionForm({ assessmentId, assessmentItemId, requirementSlNo, requirementTitle, initial, interview }: DecisionFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [status, setStatus] = useState<ComplianceRating | "">(initial.status ?? "");
  const [remarks, setRemarks] = useState(initial.remarks);
  const [actionRequired, setActionRequired] = useState(initial.actionRequired);
  const [assessorObservations, setAssessorObservations] = useState(initial.assessorObservations);
  const [officeVisitObservations, setOfficeVisitObservations] = useState(initial.officeVisitObservations);

  const [savedAt, setSavedAt] = useState<string | null>(initial.draftUpdatedAt);
  const [saving, setSaving] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionSaved, setDecisionSaved] = useState(false);

  // Autosave the two free-text drafts, debounced so it doesn't fire on
  // every keystroke. The first render is skipped: loading a page is not
  // an edit, and writing on mount would touch draft_updated_at for
  // someone who only looked.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(async () => {
      setSaving(true);
      const result = await saveObservationDrafts(assessmentItemId, assessmentId, { assessorObservations, officeVisitObservations });
      setSaving(false);
      if (result.ok) setSavedAt(new Date().toISOString());
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [assessorObservations, officeVisitObservations, assessmentItemId, assessmentId]);

  // Live validation mirrors the server's, so the assessor sees what will
  // block the save before they attempt it.
  const liveIssues =
    status === ""
      ? []
      : validateItemDecision({
          requirementSlNo,
          requirementTitle,
          isKey: false,
          status,
          remarks: remarks.trim() || null,
          actionRequired: actionRequired.trim() || null,
        });

  const requiresClosureAction = status === "Partial" || status === "Not Compliant";
  const requiresRemark = status === "Not Applicable";

  return (
    <div className="grid gap-5">
      <section>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ds-ink">Assessor observations</h2>
          <p className="text-xs text-ds-ink-2">
            {saving ? "Saving…" : savedAt ? `Draft saved ${new Date(savedAt).toLocaleTimeString()}` : "Not saved yet"}
          </p>
        </div>
        <textarea
          aria-label="Assessor observations"
          value={assessorObservations}
          rows={5}
          onChange={(event) => setAssessorObservations(event.target.value)}
          className="ds-focus-ring mt-1.5 w-full rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2 text-sm text-ds-ink"
          placeholder="What the evidence shows, in your words. Numbers and dates rather than adjectives."
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ds-ink">Office visit observations</h2>
        <textarea
          aria-label="Office visit observations"
          value={officeVisitObservations}
          rows={4}
          onChange={(event) => setOfficeVisitObservations(event.target.value)}
          className="ds-focus-ring mt-1.5 w-full rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2 text-sm text-ds-ink"
          placeholder="What was seen or discussed during the office visit."
        />
      </section>

      <InterviewInsights assessmentId={assessmentId} assessmentItemId={assessmentItemId} initial={interview} />

      <section className="rounded-ds-card border border-ds-line bg-ds-surface p-4">
        <h2 className="text-sm font-semibold text-ds-ink">Compliance status</h2>
        {/* The statement this prompt requires on the page, next to the
            control it is about rather than buried in a footer. */}
        <p className="mt-1 text-xs font-medium text-ds-ink-2">{ASSESSOR_DECISION_STATEMENT}</p>

        <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Compliance status">
          {COMPLIANCE_RATINGS.map((rating) => (
            <button
              key={rating}
              type="button"
              role="radio"
              aria-checked={status === rating}
              onClick={() => {
                setStatus(rating);
                setDecisionSaved(false);
              }}
              className={`ds-focus-ring rounded-ds-control border px-3 py-1.5 text-sm transition-colors duration-150 ${
                status === rating ? "border-ds-accent bg-ds-accent-soft font-medium text-ds-ink" : "border-ds-line bg-ds-surface text-ds-ink-2"
              }`}
            >
              {rating}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-sm font-medium text-ds-ink" htmlFor="remarks">
          Remarks{requiresRemark && <span className="ml-1 text-ds-bad">required</span>}
        </label>
        <textarea
          id="remarks"
          value={remarks}
          rows={3}
          onChange={(event) => {
            setRemarks(event.target.value);
            setDecisionSaved(false);
          }}
          className="ds-focus-ring mt-1.5 w-full rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2 text-sm text-ds-ink"
        />

        <label className="mt-3 block text-sm font-medium text-ds-ink" htmlFor="action-required">
          Action required for closure{requiresClosureAction && <span className="ml-1 text-ds-bad">required</span>}
        </label>
        <textarea
          id="action-required"
          value={actionRequired}
          rows={3}
          onChange={(event) => {
            setActionRequired(event.target.value);
            setDecisionSaved(false);
          }}
          className="ds-focus-ring mt-1.5 w-full rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2 text-sm text-ds-ink"
        />

        {liveIssues.length > 0 && (
          <ul className="mt-2 grid gap-1">
            {liveIssues.map((issue) => (
              <li key={issue.field} className="text-xs text-ds-bad">
                {issue.message}
              </li>
            ))}
          </ul>
        )}
        {decisionError && <p className="mt-2 text-xs text-ds-bad">{decisionError}</p>}
        {decisionSaved && <p className="mt-2 text-xs text-ds-ok">Status saved.</p>}

        <Button
          className="mt-3"
          disabled={pending || status === "" || liveIssues.length > 0}
          onClick={() => {
            setDecisionError(null);
            startTransition(async () => {
              const result = await saveDecision(assessmentItemId, assessmentId, {
                status,
                remarks,
                actionRequired,
                requirementSlNo,
                requirementTitle,
              });
              if (!result.ok) {
                setDecisionError(result.message);
                return;
              }
              setDecisionSaved(true);
              router.refresh();
            });
          }}
        >
          Save status
        </Button>
      </section>
    </div>
  );
}

function InterviewInsights({
  assessmentId,
  assessmentItemId,
  initial,
}: {
  assessmentId: string;
  assessmentItemId: string;
  initial: DecisionFormProps["interview"];
}) {
  const [pending, startTransition] = useTransition();
  const [count, setCount] = useState(initial.workersInterviewedCount?.toString() ?? "");
  const [nationalities, setNationalities] = useState(initial.nationalities.join(", "));
  const [interpreter, setInterpreter] = useState<"yes" | "no" | "">(
    initial.interpreterUsed === null ? "" : initial.interpreterUsed ? "yes" : "no",
  );
  const [notes, setNotes] = useState(initial.notes);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="rounded-ds-card border border-ds-line bg-ds-surface-2 p-4">
      <h2 className="text-sm font-semibold text-ds-ink">Interview insights</h2>
      {/* Stated on the screen because an assessor needs to know it before
          they write anything down: these notes are staff-only by policy
          and by table (0024_assessment_decision.sql). */}
      <p className="mt-1 text-xs text-ds-ink-2">
        Stored separately from the assessment record. Interview notes are never included in the entity-visible report.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs text-ds-ink-2" htmlFor="workers-interviewed">
            Workers interviewed
          </label>
          <input
            id="workers-interviewed"
            inputMode="numeric"
            value={count}
            onChange={(event) => {
              setCount(event.target.value);
              setSaved(false);
            }}
            className="ds-focus-ring mt-1 w-full rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-sm text-ds-ink"
          />
        </div>

        <div>
          <label className="block text-xs text-ds-ink-2" htmlFor="nationalities">
            Nationalities (comma separated)
          </label>
          <input
            id="nationalities"
            value={nationalities}
            onChange={(event) => {
              setNationalities(event.target.value);
              setSaved(false);
            }}
            className="ds-focus-ring mt-1 w-full rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-sm text-ds-ink"
          />
        </div>

        <div>
          <label className="block text-xs text-ds-ink-2" htmlFor="interpreter">
            Interpreter used
          </label>
          <select
            id="interpreter"
            value={interpreter}
            onChange={(event) => {
              setInterpreter(event.target.value as "yes" | "no" | "");
              setSaved(false);
            }}
            className="ds-focus-ring mt-1 w-full rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-sm text-ds-ink"
          >
            <option value="">Not recorded</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
      </div>

      <label className="mt-3 block text-xs text-ds-ink-2" htmlFor="interview-notes">
        Notes
      </label>
      <textarea
        id="interview-notes"
        value={notes}
        rows={3}
        onChange={(event) => {
          setNotes(event.target.value);
          setSaved(false);
        }}
        className="ds-focus-ring mt-1 w-full rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-sm text-ds-ink"
      />

      {error && <p className="mt-2 text-xs text-ds-bad">{error}</p>}
      {saved && <p className="mt-2 text-xs text-ds-ok">Interview insights saved.</p>}

      <Button
        variant="secondary"
        className="mt-3"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const parsedCount = count.trim() === "" ? null : Number(count.trim());
            if (parsedCount !== null && !Number.isInteger(parsedCount)) {
              setError("Workers interviewed must be a whole number.");
              return;
            }
            const result = await saveInterviewInsights(assessmentItemId, assessmentId, {
              workersInterviewedCount: parsedCount,
              nationalities: nationalities.split(",").map((entry) => entry.trim()),
              interpreterUsed: interpreter === "" ? null : interpreter === "yes",
              notes,
            });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            setSaved(true);
          });
        }}
      >
        Save interview insights
      </Button>
    </section>
  );
}
